(() => {
  const dictionaries = {
    ru: { brand: 'Говори', 'auth.heading': 'Понимать друг друга<br>стало проще.', 'auth.subtitle': 'Ваш спокойный голосовой переводчик для живого разговора.', 'auth.password': 'Пароль', 'auth.showPassword': 'Показать пароль', 'auth.hidePassword': 'Скрыть пароль', 'auth.signIn': 'Войти', 'auth.create': 'Создать аккаунт', 'auth.switchToRegister': 'Нет аккаунта? Создать', 'auth.switchToLogin': 'Уже есть аккаунт? Войти', 'auth.signingIn': 'Входим…', 'auth.creating': 'Создаём аккаунт…', 'welcome.kicker': 'Начните разговор', 'welcome.title': 'Нажмите и говорите', 'welcome.body': 'Я сам определю язык и переведу реплику в нужную сторону.', 'voice.ready': 'Готов слушать', 'voice.speak': 'Говорить', 'voice.done': 'Готово', 'voice.start': 'Начать голосовой ввод', 'voice.stop': 'Закончить запись', 'voice.listening': 'Слушаю… нажмите, когда закончите', 'voice.processing': 'Обрабатываю запись…', 'voice.translating': 'Перевожу…', 'voice.denied': 'Разрешите доступ к микрофону, чтобы говорить.', 'voice.unsupported': 'Голосовой ввод не поддерживается этим браузером.', 'input.label': 'Фраза для перевода', 'input.placeholder': 'Или напишите фразу', 'input.translate': 'Перевести', 'dialog.kicker': 'Язык собеседника', 'dialog.title': 'На каком языке говорить?', 'dialog.close': 'Закрыть', 'pair.choose': 'Выберите язык', 'card.source': 'Исходная фраза', 'card.translation': 'Перевод', 'play': 'Прослушать перевод', 'loadingSpeech': 'Загружаем озвучку', 'theme.dark': 'Включить тёмную тему', 'theme.light': 'Включить светлую тему', 'lang.Russian': 'Русский', 'lang.English': 'Английский', 'lang.Chinese': 'Китайский' },
    en: { brand: 'Speak', 'auth.heading': 'Understanding each other<br>is simpler now.', 'auth.subtitle': 'Your calm voice translator for real conversations.', 'auth.password': 'Password', 'auth.showPassword': 'Show password', 'auth.hidePassword': 'Hide password', 'auth.signIn': 'Sign in', 'auth.create': 'Create account', 'auth.switchToRegister': 'No account? Create one', 'auth.switchToLogin': 'Already have an account? Sign in', 'auth.signingIn': 'Signing in…', 'auth.creating': 'Creating account…', 'welcome.kicker': 'Start a conversation', 'welcome.title': 'Tap and speak', 'welcome.body': 'I will detect the language and translate in the right direction.', 'voice.ready': 'Ready to listen', 'voice.speak': 'Speak', 'voice.done': 'Done', 'voice.start': 'Start voice input', 'voice.stop': 'Finish recording', 'voice.listening': 'Listening… tap when you are done', 'voice.processing': 'Processing recording…', 'voice.translating': 'Translating…', 'voice.denied': 'Allow microphone access to speak.', 'voice.unsupported': 'Voice input is not supported in this browser.', 'input.label': 'Phrase to translate', 'input.placeholder': 'Or type a phrase', 'input.translate': 'Translate', 'dialog.kicker': 'Conversation language', 'dialog.title': 'Which language are you speaking?', 'dialog.close': 'Close', 'pair.choose': 'Choose language', 'card.source': 'Original phrase', 'card.translation': 'Translation', 'play': 'Play translation', 'loadingSpeech': 'Loading speech', 'theme.dark': 'Use dark theme', 'theme.light': 'Use light theme', 'lang.Russian': 'Russian', 'lang.English': 'English', 'lang.Chinese': 'Chinese' },
    zh: { brand: '畅谈', 'auth.heading': '彼此理解<br>变得更简单。', 'auth.subtitle': '为真实对话打造的贴心语音翻译。', 'auth.password': '密码', 'auth.showPassword': '显示密码', 'auth.hidePassword': '隐藏密码', 'auth.signIn': '登录', 'auth.create': '创建账户', 'auth.switchToRegister': '没有账户？创建一个', 'auth.switchToLogin': '已有账户？登录', 'auth.signingIn': '正在登录…', 'auth.creating': '正在创建账户…', 'welcome.kicker': '开始对话', 'welcome.title': '轻触后说话', 'welcome.body': '我会识别语言，并按正确方向翻译。', 'voice.ready': '准备聆听', 'voice.speak': '说话', 'voice.done': '完成', 'voice.start': '开始语音输入', 'voice.stop': '结束录音', 'voice.listening': '正在聆听…完成后轻触', 'voice.processing': '正在处理录音…', 'voice.translating': '正在翻译…', 'voice.denied': '请允许使用麦克风后再说话。', 'voice.unsupported': '此浏览器不支持语音输入。', 'input.label': '要翻译的短句', 'input.placeholder': '或输入短句', 'input.translate': '翻译', 'dialog.kicker': '对话语言', 'dialog.title': '您正在说哪种语言？', 'dialog.close': '关闭', 'pair.choose': '选择语言', 'card.source': '原句', 'card.translation': '翻译', 'play': '播放翻译', 'loadingSpeech': '正在加载语音', 'theme.dark': '切换深色主题', 'theme.light': '切换浅色主题', 'lang.Russian': '俄语', 'lang.English': '英语', 'lang.Chinese': '中文' },
  };
  Object.assign(dictionaries.ru, { 'pair.source': 'Я говорю', 'pair.target': 'Собеседник', 'pair.swap': 'Поменять языки местами', share: 'Поделиться переводом', sharing: 'Готовим озвучку для отправки…', shareCopied: 'Текст перевода скопирован', 'voice.hint': 'Нажмите «Говорить». Когда кнопка станет красной, начинайте говорить.', 'voice.hintRecording': 'Закончили говорить? Нажмите красную кнопку.' });
  Object.assign(dictionaries.en, { 'pair.source': 'I speak', 'pair.target': 'They speak', 'pair.swap': 'Swap languages', share: 'Share translation', sharing: 'Preparing audio to share…', shareCopied: 'Translation copied', 'voice.hint': 'Tap “Speak”. Start talking when the button turns red.', 'voice.hintRecording': 'Finished speaking? Tap the red button.' });
  Object.assign(dictionaries.zh, { 'pair.source': '我说', 'pair.target': '对方说', 'pair.swap': '交换语言', share: '分享翻译', sharing: '正在准备语音…', shareCopied: '翻译已复制', 'voice.hint': '轻触“说话”。按钮变红后即可开始说话。', 'voice.hintRecording': '说完了吗？轻触红色按钮。' });
  Object.assign(dictionaries.ru, { 'live.label': 'Авто', 'live.toggle': 'Включить живой разговор', 'live.disable': 'Выключить живой разговор', 'live.on': 'Живой разговор включён', 'live.off': 'Живой разговор выключен', 'live.connecting': 'Подключаю живой разговор…', 'live.listening': 'Живой разговор: говорите естественно', 'live.processing': 'Распознаю фразу…', 'live.unavailable': 'Живой разговор недоступен. Обычный голосовой ввод остаётся доступен.', 'live.hint': 'Живой режим сам распознаёт фразы после короткой паузы.' });
  Object.assign(dictionaries.en, { 'live.label': 'Auto', 'live.toggle': 'Turn on live conversation', 'live.disable': 'Turn off live conversation', 'live.on': 'Live conversation is on', 'live.off': 'Live conversation is off', 'live.connecting': 'Connecting live conversation…', 'live.listening': 'Live conversation: speak naturally', 'live.processing': 'Recognizing the phrase…', 'live.unavailable': 'Live conversation is unavailable. Regular voice input is still available.', 'live.hint': 'Live mode recognizes a phrase after a short pause.' });
  Object.assign(dictionaries.zh, { 'live.label': '实时', 'live.toggle': '开启实时对话', 'live.disable': '关闭实时对话', 'live.on': '实时对话已开启', 'live.off': '实时对话已关闭', 'live.connecting': '正在连接实时对话…', 'live.listening': '实时对话：请自然说话', 'live.processing': '正在识别短句…', 'live.unavailable': '实时对话暂不可用，普通语音输入仍可使用。', 'live.hint': '实时模式会在短暂停顿后识别一句话。' });
  Object.assign(dictionaries.en, {
    'lang.Russian': 'Russian', 'lang.English': 'English', 'lang.Chinese': 'Chinese', 'lang.Spanish': 'Spanish', 'lang.German': 'German', 'lang.French': 'French', 'lang.Japanese': 'Japanese', 'lang.Korean': 'Korean', 'lang.Arabic': 'Arabic', 'lang.Turkish': 'Turkish', 'lang.Italian': 'Italian', 'lang.Portuguese': 'Portuguese', 'lang.Vietnamese': 'Vietnamese', 'lang.Thai': 'Thai', 'lang.Hindi': 'Hindi', 'lang.Polish': 'Polish',
  });
  Object.assign(dictionaries.zh, {
    'lang.Russian': '俄语', 'lang.English': '英语', 'lang.Chinese': '中文', 'lang.Spanish': '西班牙语', 'lang.German': '德语', 'lang.French': '法语', 'lang.Japanese': '日语', 'lang.Korean': '韩语', 'lang.Arabic': '阿拉伯语', 'lang.Turkish': '土耳其语', 'lang.Italian': '意大利语', 'lang.Portuguese': '葡萄牙语', 'lang.Vietnamese': '越南语', 'lang.Thai': '泰语', 'lang.Hindi': '印地语', 'lang.Polish': '波兰语',
  });
  Object.assign(dictionaries.ru, { 'auth.companyLabel': 'Компания', 'auth.companyPlaceholder': 'Ваша компания', 'auth.companyRequired': 'Укажите вашу компанию.', 'auth.privacy': 'Данные аккаунта и история переводов хранятся на сервере приложения. Голос и текст передаются OpenAI для распознавания, перевода и озвучивания. Не указывайте коммерческие тайны.' });
  Object.assign(dictionaries.en, { 'auth.companyLabel': 'Company', 'auth.companyPlaceholder': 'Your company', 'auth.companyRequired': 'Enter your company.', 'auth.privacy': 'Account data and translation history are stored on the application server. Voice and text are sent to OpenAI for transcription, translation, and speech. Do not enter trade secrets.' });
  Object.assign(dictionaries.zh, { 'auth.companyLabel': '公司', 'auth.companyPlaceholder': '您的公司', 'auth.companyRequired': '请填写您的公司。', 'auth.privacy': '账户数据和翻译记录存储在应用服务器上。语音和文本会发送至 OpenAI 用于转写、翻译和语音合成。请勿输入商业机密。' });
  Object.assign(dictionaries.ru, { 'trial.remaining': 'Пробный · {count}/3', 'trial.limit': 'Три бесплатных перевода использованы.', 'trial.live': 'Живой разговор доступен после регистрации.', 'trial.back': 'Вернуться к переводчику', 'trial.menuOpen': 'Открыть меню', 'trial.menuTitle': 'Гостевой доступ', 'trial.menuStatus': 'У вас осталось бесплатных переводов: {count} из 3.', 'trial.create': 'Создать аккаунт', 'trial.signIn': 'Уже есть аккаунт? Войти', 'trial.title': 'Пробный перевод завершён', 'trial.body': 'Создайте аккаунт, чтобы продолжить разговор и сохранить историю переводов.', 'history.open': 'История диалогов' });
  Object.assign(dictionaries.en, { 'trial.remaining': 'Trial · {count}/3', 'trial.limit': 'Your three free translations are used.', 'trial.live': 'Live conversation is available after registration.', 'trial.back': 'Back to translator', 'trial.menuOpen': 'Open menu', 'trial.menuTitle': 'Guest access', 'trial.menuStatus': 'You have {count} of 3 free translations left.', 'trial.create': 'Create account', 'trial.signIn': 'Already have an account? Sign in', 'trial.title': 'Your trial is complete', 'trial.body': 'Create an account to keep talking and save your translation history.', 'history.open': 'Conversation history' });
  Object.assign(dictionaries.zh, { 'trial.remaining': '试用 · {count}/3', 'trial.limit': '三次免费翻译已用完。', 'trial.live': '注册后即可使用实时对话。', 'trial.back': '返回翻译器', 'trial.menuOpen': '打开菜单', 'trial.menuTitle': '访客模式', 'trial.menuStatus': '您还剩 {count}/3 次免费翻译。', 'trial.create': '创建账户', 'trial.signIn': '已有账户？登录', 'trial.title': '试用已结束', 'trial.body': '创建账户即可继续对话并保存翻译记录。', 'history.open': '对话记录' });
  Object.assign(dictionaries.ru, {
    'settings.interface': 'Настройки интерфейса',
    'settings.language': 'Язык интерфейса',
    'pair.languages': 'Языки перевода',
    'voice.listeningSaved': 'Слушаю… сохранено частей: {count}',
    'voice.finalizing': 'Собираю и распознаю запись…',
    'voice.emptyLong': 'Не удалось распознать запись. Попробуйте ещё раз.',
    'voice.partialTranscript': 'Часть записи не распознана. Сохраняю доступный текст…',
    'card.transcriptOnly': 'Распознано — перевод недоступен',
  });
  Object.assign(dictionaries.en, {
    'settings.interface': 'Interface settings',
    'settings.language': 'Interface language',
    'pair.languages': 'Translation languages',
    'voice.listeningSaved': 'Listening… saved parts: {count}',
    'voice.finalizing': 'Finishing transcription…',
    'voice.emptyLong': 'Could not recognize the recording. Please try again.',
    'voice.partialTranscript': 'Part of the recording could not be recognized. Saving the available text…',
    'card.transcriptOnly': 'Transcript — translation unavailable',
  });
  Object.assign(dictionaries.zh, {
    'settings.interface': '界面设置',
    'settings.language': '界面语言',
    'pair.languages': '翻译语言',
    'voice.listeningSaved': '正在聆听…已保存 {count} 段',
    'voice.finalizing': '正在整理并转写录音…',
    'voice.emptyLong': '无法识别录音，请重试。',
    'voice.partialTranscript': '部分录音无法识别，正在保存已转写的文本…',
    'card.transcriptOnly': '已转写 — 翻译暂不可用',
  });
  Object.assign(dictionaries.ru, {
    'auth.emailInvalid': 'Введите корректный email, например name@example.com.',
    'auth.passwordShort': 'Пароль должен содержать не менее 8 символов.',
    'history.delete': 'Удалить беседу',
    'history.deleteConfirm': 'Удалить беседу «{title}»? Это действие нельзя отменить.',
    'error.generic': 'Не получилось выполнить действие. Попробуйте ещё раз.',
    'error.network': 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
    'error.internal': 'На сервере произошла ошибка. Попробуйте ещё раз чуть позже.',
    'error.invalidInput': 'Проверьте введённые данные и попробуйте ещё раз.',
    'error.companyRequired': 'Укажите вашу компанию.',
    'error.companyTooLong': 'Название компании должно быть короче 160 символов.',
    'error.emailTaken': 'Этот email уже зарегистрирован. Попробуйте войти.',
    'error.invalidCredentials': 'Неверный email или пароль. Проверьте данные и попробуйте ещё раз.',
    'error.notAuthenticated': 'Войдите в аккаунт, чтобы продолжить.',
    'error.trialLimit': 'Три бесплатных перевода использованы. Создайте аккаунт, чтобы продолжить.',
    'error.registrationRequired': 'Создайте аккаунт, чтобы продолжить.',
    'error.emptyAudio': 'Запись получилась пустой. Нажмите «Говорить» и попробуйте ещё раз.',
    'error.audioTooLarge': 'Не удалось отправить часть записи. Проверьте соединение и попробуйте ещё раз.',
    'error.emptyTranscript': 'Не удалось распознать речь. Попробуйте говорить ближе к микрофону.',
    'error.voiceLanguageMismatch': 'Речь не совпала с выбранным языком. Проверьте язык «Я говорю».',
    'error.liveInvalid': 'Не удалось начать живой разговор. Попробуйте обычный голосовой ввод.',
    'error.liveUnavailable': 'Живой разговор сейчас недоступен. Используйте обычный голосовой ввод.',
    'error.unknownLanguage': 'Выберите язык из списка.',
    'error.invalidLanguagePair': 'Выберите два разных языка.',
    'error.conversationNotFound': 'Эта беседа больше недоступна. Обновите историю.',
    'error.translationFailed': 'Не удалось перевести сообщение. Распознанный текст сохранён ниже.',
    'error.tooManyRequests': 'Слишком много запросов подряд. Подождите немного и повторите.',
    'error.speechPrepare': 'Не удалось подготовить озвучку. Попробуйте ещё раз.',
    'error.audioLoad': 'Не удалось загрузить озвучку. Нажмите кнопку ещё раз.',
    'error.audioPlayback': 'Не удалось воспроизвести озвучку. Попробуйте ещё раз.',
    'error.share': 'Не удалось открыть отправку. Скопируйте текст и попробуйте ещё раз.',
  });
  Object.assign(dictionaries.en, {
    'auth.emailInvalid': 'Enter a valid email, for example name@example.com.',
    'auth.passwordShort': 'Password must be at least 8 characters.',
    'history.delete': 'Delete conversation',
    'history.deleteConfirm': 'Delete “{title}”? This action cannot be undone.',
    'error.generic': 'We could not complete that action. Please try again.',
    'error.network': 'Could not reach the server. Check your connection and try again.',
    'error.internal': 'Something went wrong on the server. Please try again shortly.',
    'error.invalidInput': 'Check the entered information and try again.',
    'error.companyRequired': 'Enter your company.',
    'error.companyTooLong': 'Company name must be shorter than 160 characters.',
    'error.emailTaken': 'This email is already registered. Try signing in.',
    'error.invalidCredentials': 'Incorrect email or password. Check them and try again.',
    'error.notAuthenticated': 'Sign in to continue.',
    'error.trialLimit': 'Your three free translations are used. Create an account to continue.',
    'error.registrationRequired': 'Create an account to continue.',
    'error.emptyAudio': 'The recording is empty. Tap “Speak” and try again.',
    'error.audioTooLarge': 'Could not send part of the recording. Check your connection and try again.',
    'error.emptyTranscript': 'Could not recognize the speech. Try speaking closer to the microphone.',
    'error.voiceLanguageMismatch': 'The speech did not match the selected language. Check “I speak”.',
    'error.liveInvalid': 'Could not start live conversation. Try regular voice input.',
    'error.liveUnavailable': 'Live conversation is unavailable right now. Use regular voice input.',
    'error.unknownLanguage': 'Choose a language from the list.',
    'error.invalidLanguagePair': 'Choose two different languages.',
    'error.conversationNotFound': 'This conversation is no longer available. Refresh the history.',
    'error.translationFailed': 'Could not translate the message. The transcript is saved below.',
    'error.tooManyRequests': 'Too many requests in a row. Wait a moment and try again.',
    'error.speechPrepare': 'Could not prepare the audio. Please try again.',
    'error.audioLoad': 'Could not load the audio. Tap the button again.',
    'error.audioPlayback': 'Could not play the audio. Please try again.',
    'error.share': 'Could not open sharing. Copy the text and try again.',
  });
  Object.assign(dictionaries.zh, {
    'auth.emailInvalid': '请输入有效的邮箱，例如 name@example.com。',
    'auth.passwordShort': '密码至少需要 8 个字符。',
    'history.delete': '删除对话',
    'history.deleteConfirm': '删除对话“{title}”？此操作无法撤销。',
    'error.generic': '暂时无法完成此操作，请重试。',
    'error.network': '无法连接服务器，请检查网络后重试。',
    'error.internal': '服务器出现错误，请稍后重试。',
    'error.invalidInput': '请检查输入内容后重试。',
    'error.companyRequired': '请输入您的公司。',
    'error.companyTooLong': '公司名称不能超过 160 个字符。',
    'error.emailTaken': '该邮箱已注册，请尝试登录。',
    'error.invalidCredentials': '邮箱或密码不正确，请检查后重试。',
    'error.notAuthenticated': '请登录后继续。',
    'error.trialLimit': '三次免费翻译已用完，请创建账户后继续。',
    'error.registrationRequired': '请创建账户后继续。',
    'error.emptyAudio': '录音为空，请轻触“说话”后重试。',
    'error.audioTooLarge': '无法发送部分录音，请检查网络后重试。',
    'error.emptyTranscript': '无法识别语音，请靠近麦克风后重试。',
    'error.voiceLanguageMismatch': '语音与所选语言不一致，请检查“我说”的语言。',
    'error.liveInvalid': '无法开始实时对话，请使用普通语音输入。',
    'error.liveUnavailable': '实时对话暂不可用，请使用普通语音输入。',
    'error.unknownLanguage': '请从列表中选择语言。',
    'error.invalidLanguagePair': '请选择两种不同的语言。',
    'error.conversationNotFound': '该对话已不可用，请刷新对话记录。',
    'error.translationFailed': '无法翻译此消息，已在下方保留转写文本。',
    'error.tooManyRequests': '请求过于频繁，请稍等片刻后重试。',
    'error.speechPrepare': '无法生成语音，请重试。',
    'error.audioLoad': '无法加载语音，请再次轻触播放按钮。',
    'error.audioPlayback': '无法播放语音，请重试。',
    'error.share': '无法打开分享，请复制文本后重试。',
  });
  Object.assign(dictionaries.ru, {"shared.create": "Общая беседа", "shared.invite": "Пригласить", "shared.leave": "Выйти", "shared.title": "Разговор на расстоянии", "shared.body": "Выберите языки выше. Отправьте ссылку собеседнику — вы оба увидите реплики и переводы в одной беседе.", "shared.name": "Ваше имя", "shared.start": "Создать беседу", "shared.cancel": "Отмена", "shared.join": "Подключиться", "shared.waiting": "Ожидаем собеседника", "shared.online": "Собеседник в сети", "shared.offline": "Собеседник не в сети", "shared.reconnecting": "Восстанавливаем связь…", "shared.created": "Беседа создана. Нажмите «Пригласить», чтобы отправить ссылку.", "shared.copied": "Ссылка скопирована", "shared.invitation": "Присоединяйтесь к беседе с переводом", "shared.you": "Вы", "shared.them": "Собеседник", "shared.translating": "Перевожу…", "shared.failed": "Перевод не получился. Реплика сохранена.", "shared.retry": "Повторить", "shared.finishRecording": "Сначала завершите запись и перевод.", "error.roomNotFound": "Беседа не найдена или недоступна.", "error.roomFull": "В беседе уже есть два участника."});
  Object.assign(dictionaries.en, {"shared.create": "Shared conversation", "shared.invite": "Invite", "shared.leave": "Leave", "shared.title": "Talk from anywhere", "shared.body": "Choose the languages above. Share a link to see messages and translations together.", "shared.name": "Your name", "shared.start": "Create conversation", "shared.cancel": "Cancel", "shared.join": "Join conversation", "shared.waiting": "Waiting for your partner", "shared.online": "Partner is online", "shared.offline": "Partner is offline", "shared.reconnecting": "Reconnecting…", "shared.created": "Conversation created. Tap Invite to share the link.", "shared.copied": "Link copied", "shared.invitation": "Join my translated conversation", "shared.you": "You", "shared.them": "Partner", "shared.translating": "Translating…", "shared.failed": "Translation failed. Your message is saved.", "shared.retry": "Retry", "shared.finishRecording": "Finish recording and translating first.", "error.roomNotFound": "Conversation not found or unavailable.", "error.roomFull": "This conversation already has two participants."});
  Object.assign(dictionaries.zh, {"shared.create": "共享对话", "shared.invite": "邀请", "shared.leave": "退出", "shared.title": "远程交流", "shared.body": "选择上方的语言，分享链接，即可一起查看消息和翻译。", "shared.name": "您的名字", "shared.start": "创建对话", "shared.cancel": "取消", "shared.join": "加入对话", "shared.waiting": "等待对方加入", "shared.online": "对方在线", "shared.offline": "对方离线", "shared.reconnecting": "正在重新连接…", "shared.created": "对话已创建。点击邀请分享链接。", "shared.copied": "链接已复制", "shared.invitation": "加入我的翻译对话", "shared.you": "您", "shared.them": "对方", "shared.translating": "正在翻译…", "shared.failed": "翻译失败，消息已保存。", "shared.retry": "重试", "shared.finishRecording": "请先结束录音和翻译。", "error.roomNotFound": "对话不存在或无法访问。", "error.roomFull": "对话已有两位参与者。"});
  Object.assign(dictionaries.ru, { 'shared.joinBody': 'Вас пригласили в общую беседу. Введите имя и подключитесь — языки перевода настроятся автоматически.', 'history.title': 'История разговоров', 'history.new': 'Новый разговор', 'history.empty': 'Здесь появятся ваши личные и общие беседы.', 'stopSpeech': 'Остановить озвучку', 'shared.link': 'Ссылка для собеседника', 'shared.copy': 'Копировать', 'shared.empty': 'Говорите или пишите. Ваши реплики и ответы собеседника появятся здесь.' });
  Object.assign(dictionaries.en, { 'shared.joinBody': 'You have been invited to a shared conversation. Enter your name and join — translation languages will be set automatically.', 'history.title': 'Conversation history', 'history.new': 'New conversation', 'history.empty': 'Your private and shared conversations will appear here.', 'stopSpeech': 'Stop playback', 'shared.link': 'Link for your partner', 'shared.copy': 'Copy link', 'shared.empty': 'Speak or type. Your messages and your partner’s replies will appear here.' });
  Object.assign(dictionaries.zh, { 'shared.joinBody': '您受邀加入共享对话。输入名字并加入，翻译语言将自动设置。', 'history.title': '对话记录', 'history.new': '新对话', 'history.empty': '您的个人和共享对话将在此显示。', 'stopSpeech': '停止播放', 'shared.link': '对话邀请链接', 'shared.copy': '复制链接', 'shared.empty': '说话或打字。您和对方的消息将在此显示。' });
  Object.assign(dictionaries.ru, {
    'shared.audience': 'Языки участников', 'shared.new': 'Новая общая беседа', 'shared.roomTitle': 'Название беседы',
    'shared.roomTitlePlaceholder': 'Например, друзья или поездка', 'shared.myLanguage': 'Мой язык',
    'shared.people': 'Участники', 'shared.count': 'Участников: {count}', 'shared.onlineCount': '{count} в сети',
    'shared.body': 'Назовите беседу и выберите свой язык. По ссылке смогут подключиться несколько человек, каждый со своим языком.',
    'shared.joinBody': 'Введите имя и выберите язык. Сообщения остальных будут переводиться на него.',
    'shared.roomDefault': 'Общая беседа', 'shared.original': 'Сообщение уже на вашем языке',
  });
  Object.assign(dictionaries.en, {
    'shared.audience': 'Participant languages', 'shared.new': 'New shared conversation', 'shared.roomTitle': 'Conversation name',
    'shared.roomTitlePlaceholder': 'For example, friends or a trip', 'shared.myLanguage': 'My language',
    'shared.people': 'Participants', 'shared.count': '{count} participants', 'shared.onlineCount': '{count} online',
    'shared.body': 'Name the conversation and choose your language. Several people can join the link, each with their own language.',
    'shared.joinBody': 'Enter your name and choose your language. Messages from others will be translated into it.',
    'shared.roomDefault': 'Shared conversation', 'shared.original': 'This message is already in your language',
  });
  Object.assign(dictionaries.zh, {
    'shared.audience': '参与者语言', 'shared.new': '新建共享对话', 'shared.roomTitle': '对话名称', 'shared.roomTitlePlaceholder': '例如：朋友或旅行',
    'shared.myLanguage': '我的语言', 'shared.people': '参与者', 'shared.count': '{count}位参与者',
    'shared.onlineCount': '{count}人在线', 'shared.body': '为对话命名并选择您的语言。多人可通过链接加入，各自选择语言。',
    'shared.joinBody': '输入姓名并选择语言。其他人的消息将翻译为该语言。',
    'shared.roomDefault': '共享对话', 'shared.original': '此消息已使用您的语言',
  });
  Object.assign(dictionaries.ru, { 'shared.controls':'Настройки беседы', 'shared.created':'Беседа создана. Откройте «Настройки беседы», чтобы пригласить участников.', 'settings.chatFont':'Размер текста чата', 'settings.fontSmall':'Мелкий', 'settings.fontNormal':'Обычный', 'settings.fontLarge':'Крупный', 'settings.fontLargest':'Очень крупный', 'settings.fontPreview':'Так будут выглядеть сообщения и переводы.' });
  Object.assign(dictionaries.en, { 'shared.controls':'Conversation settings', 'shared.created':'Conversation created. Open conversation settings to invite people.', 'settings.chatFont':'Chat text size', 'settings.fontSmall':'Small', 'settings.fontNormal':'Regular', 'settings.fontLarge':'Large', 'settings.fontLargest':'Extra large', 'settings.fontPreview':'This is how messages and translations will look.' });
  Object.assign(dictionaries.zh, { 'shared.controls':'对话设置', 'shared.created':'对话已创建。打开对话设置以邀请参与者。', 'settings.chatFont':'聊天文字大小', 'settings.fontSmall':'小', 'settings.fontNormal':'标准', 'settings.fontLarge':'大', 'settings.fontLargest':'超大', 'settings.fontPreview':'消息和翻译将以此大小显示。' });
  const savedLocale = localStorage.getItem('ui-locale');
  let locale = (['ru', 'en', 'zh'].includes(savedLocale) ? savedLocale : null) || (navigator.language.startsWith('zh') ? 'zh' : navigator.language.startsWith('en') ? 'en' : 'ru');
  const t = (key) => dictionaries[locale][key] || dictionaries.ru[key] || key;
  const errorKeys = {
    ROOM_NOT_FOUND: 'error.roomNotFound', ROOM_FULL: 'error.roomFull',
    INVALID_INPUT: 'error.invalidInput', COMPANY_REQUIRED: 'error.companyRequired', COMPANY_TOO_LONG: 'error.companyTooLong', EMAIL_TAKEN: 'error.emailTaken', INVALID_CREDENTIALS: 'error.invalidCredentials', NOT_AUTHENTICATED: 'error.notAuthenticated', TRIAL_LIMIT_REACHED: 'error.trialLimit', REGISTRATION_REQUIRED: 'error.registrationRequired', EMPTY_AUDIO: 'error.emptyAudio', AUDIO_TOO_LARGE: 'error.audioTooLarge', EMPTY_TRANSCRIPT: 'error.emptyTranscript', VOICE_LANGUAGE_MISMATCH: 'error.voiceLanguageMismatch', INVALID_LIVE_SESSION: 'error.liveInvalid', LIVE_UNAVAILABLE: 'error.liveUnavailable', UNKNOWN_LANGUAGE: 'error.unknownLanguage', INVALID_LANGUAGE_PAIR: 'error.invalidLanguagePair', CONVERSATION_NOT_FOUND: 'error.conversationNotFound', TRANSLATION_FAILED: 'error.translationFailed', SPEECH_PREPARE_FAILED: 'error.speechPrepare', AUDIO_LOAD_FAILED: 'error.audioLoad', INTERNAL_ERROR: 'error.internal',
  };
  function errorMessage(error, fallbackKey = 'error.generic') {
    const key = errorKeys[error?.code || error?.message];
    if (key) return t(key);
    if (error?.status === 429) return t('error.tooManyRequests');
    if (error?.status >= 500) return t('error.internal');
    if (['NotAllowedError', 'PermissionDeniedError'].includes(error?.name)) return t('voice.denied');
    if (error?.name === 'TypeError' && !error?.status) return t('error.network');
    return t(fallbackKey);
  }
  function render() { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale; document.querySelectorAll('[data-i18n]').forEach((element) => { element.innerHTML = t(element.dataset.i18n); }); document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); }); document.querySelectorAll('[data-i18n-aria]').forEach((element) => { element.setAttribute('aria-label', t(element.dataset.i18nAria)); }); window.dispatchEvent(new Event('localechange')); }
  const select = document.getElementById('ui-language'); select.value = locale; select.addEventListener('change', () => { locale = select.value; localStorage.setItem('ui-locale', locale); render(); });
  const fontSelect = document.getElementById('chat-font-size');
  const savedFont = localStorage.getItem('chat-font-size');
  fontSelect.value = ['16','18','20','24'].includes(savedFont) ? savedFont : '18';
  function applyChatFont() { document.documentElement.style.setProperty('--chat-font-size', `${fontSelect.value}px`); }
  fontSelect.addEventListener('change', () => { localStorage.setItem('chat-font-size', fontSelect.value); applyChatFont(); });
  document.getElementById('chat-font-open').addEventListener('click', () => document.getElementById('chat-font-dialog').showModal());
  document.getElementById('chat-font-close').addEventListener('click', () => document.getElementById('chat-font-dialog').close());
  applyChatFont();
  dictionaries.ru['chat.latest'] = 'К последнему сообщению';
  dictionaries.en['chat.latest'] = 'Jump to latest message';
  dictionaries.zh['chat.latest'] = '跳到最新消息';
  const themeButton = document.getElementById('theme-toggle'); let theme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); function applyTheme() { document.documentElement.dataset.theme = theme; themeButton.setAttribute('aria-label', t(theme === 'dark' ? 'theme.light' : 'theme.dark')); } themeButton.addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', theme); applyTheme(); }); window.addEventListener('localechange', applyTheme); window.t = t; window.errorMessage = errorMessage; window.getLocale = () => locale; render(); applyTheme();
})();
