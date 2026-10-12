"""Deploy the translator to the host in serv.txt without changing other sites.
Requires paramiko locally. Credentials and API keys are never printed.
"""
from pathlib import Path
import hashlib
import io
import json
import secrets
import sqlite3
import tarfile
import tempfile
import urllib.request
import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

root = Path(__file__).resolve().parent.parent
credentials = (root / 'serv.txt').read_text().splitlines()
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(credentials[0].strip(), username=credentials[1].strip(), password=credentials[2].strip(), timeout=20)

def run(command):
    _, stdout, stderr = client.exec_command(command, timeout=600)
    for line in stdout:
        print(line.rstrip(), flush=True)
    errors = stderr.read().decode()
    if errors:
        print(errors, flush=True)
    status = stdout.channel.recv_exit_status()
    if status:
        raise RuntimeError(f'Remote command exited {status}')

sftp = client.open_sftp()
run('mkdir -p /opt/lexiqs/runtime /opt/lexiqs/app /var/www/lexiqs-acme; id lexiqs >/dev/null 2>&1 || useradd --system --home /opt/lexiqs --shell /usr/sbin/nologin lexiqs')
# Install an isolated Node runtime, leaving Node used by other services intact.
versions = json.load(urllib.request.urlopen('https://nodejs.org/dist/index.json'))
version = next(item['version'] for item in versions if item['version'].startswith('v22.') and item.get('lts'))
filename = f'node-{version}-linux-x64.tar.xz'
base = f'https://nodejs.org/dist/{version}/'
checksums = urllib.request.urlopen(base + 'SHASUMS256.txt').read().decode()
expected = next(line.split()[0] for line in checksums.splitlines() if line.endswith('  ' + filename))
binary = urllib.request.urlopen(base + filename).read()
if hashlib.sha256(binary).hexdigest() != expected:
    raise RuntimeError('Node checksum mismatch')
sftp.putfo(io.BytesIO(binary), '/opt/lexiqs/runtime/node.tar.xz')
run('tar -xJf /opt/lexiqs/runtime/node.tar.xz --strip-components=1 -C /opt/lexiqs/runtime; /opt/lexiqs/runtime/bin/node --version')

with tempfile.TemporaryDirectory() as staging:
    snapshot = Path(staging) / 'app.db'
    # SQLite backup includes WAL data safely, without copying live database files.
    with sqlite3.connect(root / 'data/app.db') as source, sqlite3.connect(snapshot) as target:
        source.backup(target)
    source.close()
    target.close()
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode='w:gz') as tar:
        for name in ['server.js', 'package.json', 'package-lock.json', 'src', 'public']:
            tar.add(root / name, arcname=name)
    archive.seek(0)
    sftp.putfo(archive, '/opt/lexiqs/app-release.tar.gz')
    run('if [ -f /opt/lexiqs/app/server.js ]; then tar -czf /opt/lexiqs/previous-release.tar.gz -C /opt/lexiqs/app server.js package.json package-lock.json src public; fi; tar -xzf /opt/lexiqs/app-release.tar.gz -C /opt/lexiqs/app; mkdir -p /opt/lexiqs/app/data')
    try:
        sftp.stat('/opt/lexiqs/app/data/app.db')
    except FileNotFoundError:
        sftp.put(str(snapshot), '/opt/lexiqs/app/data/app.db')

try:
    sftp.stat('/opt/lexiqs/app/.env')
except FileNotFoundError:
    env = (root / '.env').read_text().splitlines()
    allowed = ['OPENAI_API_KEY', 'TRANSLATOR_MODEL', 'TTS_MODEL', 'TTS_VOICE', 'TRANSCRIBE_MODEL']
    env = [line for line in env if line.partition('=')[0] in allowed]
    env += ['PORT=3011', 'NODE_ENV=production', 'TRUST_PROXY=1', 'COOKIE_SECURE=1', 'SESSION_SECRET=' + secrets.token_hex(48)]
    with sftp.file('/opt/lexiqs/app/.env', 'w') as file:
        file.write('\n'.join(env) + '\n')
    sftp.chmod('/opt/lexiqs/app/.env', 0o600)

run('cd /opt/lexiqs/app && PATH=/opt/lexiqs/runtime/bin:$PATH npm ci --omit=dev --no-audit --no-fund')
service = '''[Unit]
Description=Lexiqs translator
After=network.target
[Service]
User=lexiqs
Group=lexiqs
WorkingDirectory=/opt/lexiqs/app
ExecStart=/opt/lexiqs/runtime/bin/node /opt/lexiqs/app/server.js
Environment=PATH=/opt/lexiqs/runtime/bin:/usr/bin:/bin
Environment=HOST=127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/lexiqs/app/data
[Install]
WantedBy=multi-user.target
'''
with sftp.file('/etc/systemd/system/lexiqs.service', 'w') as file:
    file.write(service)
run('chown -R lexiqs:lexiqs /opt/lexiqs/app; systemctl daemon-reload; systemctl enable --now lexiqs; systemctl restart lexiqs')

http_config = '''server {
    listen 80;
    listen [::]:80;
    server_name lexiqs.space;
    location /.well-known/acme-challenge/ { root /var/www/lexiqs-acme; }
    location / { return 301 https://lexiqs.space$request_uri; }
}
'''
with sftp.file('/etc/nginx/sites-available/lexiqs', 'w') as file:
    file.write(http_config)
run('ln -sfn /etc/nginx/sites-available/lexiqs /etc/nginx/sites-enabled/lexiqs; nginx -t && systemctl reload nginx')
run('certbot certonly --config-dir /etc/letsencrypt-lexiqs --work-dir /var/lib/letsencrypt-lexiqs --logs-dir /var/log/letsencrypt-lexiqs --webroot -w /var/www/lexiqs-acme -d lexiqs.space --non-interactive --agree-tos --register-unsafely-without-email')
https_config = '''server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name lexiqs.space;
    ssl_certificate /etc/letsencrypt-lexiqs/live/lexiqs.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt-lexiqs/live/lexiqs.space/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 25m;
    add_header Referrer-Policy "no-referrer" always;
    location = /login { return 302 /; }
    location / {
        proxy_pass http://127.0.0.1:3011;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 180s;
    }
}
'''
with sftp.file('/etc/nginx/sites-available/lexiqs', 'w') as file:
    file.write(http_config + https_config)
run('nginx -t && systemctl reload nginx; systemctl is-active lexiqs; curl --retry 6 --retry-all-errors --retry-delay 1 --fail --silent --show-error https://lexiqs.space/health')
# Renewed certificates need nginx to reload them.
with sftp.file('/etc/letsencrypt-lexiqs/renewal-hooks/deploy/lexiqs-nginx', 'w') as file:
    file.write('#!/bin/sh\nsystemctl reload nginx\n')
sftp.chmod('/etc/letsencrypt-lexiqs/renewal-hooks/deploy/lexiqs-nginx', 0o755)
with sftp.file('/etc/systemd/system/lexiqs-certificate.service', 'w') as file:
    file.write('[Unit]\nDescription=Renew Lexiqs HTTPS certificate\n[Service]\nType=oneshot\nExecStart=/usr/bin/certbot renew --config-dir /etc/letsencrypt-lexiqs --work-dir /var/lib/letsencrypt-lexiqs --logs-dir /var/log/letsencrypt-lexiqs --no-random-sleep-on-renew --quiet\n')
with sftp.file('/etc/systemd/system/lexiqs-certificate.timer', 'w') as file:
    file.write('[Unit]\nDescription=Check Lexiqs HTTPS certificate twice daily\n[Timer]\nOnCalendar=*-*-* 03,15:00:00\nRandomizedDelaySec=1800\nPersistent=true\n[Install]\nWantedBy=timers.target\n')
run('systemctl daemon-reload; systemctl enable --now lexiqs-certificate.timer')
client.close()
