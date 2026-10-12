"""Upload a checked source release, preserving environment, database and other sites."""
from pathlib import Path
import hashlib, io, json, sys, tarfile
import paramiko
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
root = Path(__file__).resolve().parent.parent
credentials = (root / 'serv.txt').read_text().splitlines()
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(credentials[0].strip(), username=credentials[1].strip(), password=credentials[2].strip(), timeout=20)
def run(command):
    _, out, err = ssh.exec_command(command, timeout=120)
    output = out.read().decode(); error = err.read().decode()
    if out.channel.recv_exit_status(): raise RuntimeError(error or output)
    return output
run("mkdir -p /opt/lexiqs/backups; tar -czf /opt/lexiqs/backups/source-before-qa.tar.gz -C /opt/lexiqs/app server.js src public")
run("python3 - <<'PY'\nimport sqlite3\ns=sqlite3.connect('/opt/lexiqs/app/data/app.db')\nt=sqlite3.connect('/opt/lexiqs/backups/app-before-qa.db')\ns.backup(t)\nt.close()\ns.close()\nPY")
files = [root/'server.js', *(root/'src').rglob('*.js'), *(root/'public').rglob('*')]
files = [f for f in files if f.is_file()]
bundle = io.BytesIO()
with tarfile.open(fileobj=bundle,mode='w:gz') as archive:
    for file in files: archive.add(file,arcname=file.relative_to(root).as_posix())
bundle.seek(0)
sftp = ssh.open_sftp(); sftp.putfo(bundle,'/opt/lexiqs/qa-release.tar.gz')
run('tar -xzf /opt/lexiqs/qa-release.tar.gz -C /opt/lexiqs/app; chown -R lexiqs:lexiqs /opt/lexiqs/app/public /opt/lexiqs/app/src /opt/lexiqs/app/server.js; systemctl restart lexiqs')
for file in files:
    with sftp.file('/opt/lexiqs/app/'+file.relative_to(root).as_posix(),'rb') as remote:
        assert hashlib.sha256(remote.read()).digest() == hashlib.sha256(file.read_bytes()).digest()
print('Source hashes match:',len(files))
print(run('systemctl is-active lexiqs; nginx -t 2>&1; systemctl is-enabled lexiqs-certificate.timer; curl --retry 6 --retry-all-errors --retry-delay 1 -fsS https://lexiqs.space/ -o /dev/null -w "Translator HTTP: %{http_code}"').strip())
print('IP-only Bitship:', run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/login -H "Host: '+credentials[0].strip()+'"'))
sftp.close(); ssh.close()
