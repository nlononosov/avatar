const { getUserByTwitchId, getAvatarByTwitchId } = require('../lib/db/async');

function registerSuccessRoute(app) {
  app.get('/success', async (req, res) => {
    const uid = req.cookies.uid;
    const profile = uid ? await getUserByTwitchId(String(uid)) : null;

    const name = profile?.display_name || profile?.login || '';
    const avatar = profile?.profile_image_url || '';
    
    // Get user's avatar data
    const avatarData = uid ? await getAvatarByTwitchId(String(uid)) : null;
    const login = profile?.login || '';

    res.status(200).send(`
<!doctype html>
<html lang="ru">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Панель управления - Avatar System</title>
<style>
  :root {
    --primary: #9146ff;
    --primary-dark: #7c3aed;
    --secondary: #fbbf24;
    --accent: #10b981;
    --danger: #ef4444;
    --warning: #f59e0b;
    --bg-dark: #0f172a;
    --bg-card: #111827;
    --bg-card-hover: #1f2937;
    --text-primary: #e2e8f0;
    --text-secondary: #9ca3af;
    --border: #374151;
    --border-light: #4b5563;
  }
  
  * { box-sizing: border-box; }
  
  body { 
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; 
    background: var(--bg-dark); 
    color: var(--text-primary); 
    margin: 0; 
    min-height: 100vh;
    line-height: 1.6;
  }
  
  .navbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
    z-index: 1000;
    padding: 0;
  }
  
  .nav-container {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 20px;
  }
  
  .nav-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 18px;
    color: var(--text-primary);
  }
  
  .nav-icon {
    font-size: 24px;
  }
  
  .nav-links {
    display: flex;
    gap: 20px;
  }
  
  .nav-link {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    text-decoration: none;
    padding: 8px 16px;
    border-radius: 8px;
    transition: all 0.3s ease;
    font-weight: 500;
  }
  
  .nav-link:hover {
    color: var(--text-primary);
    background: var(--bg-card);
  }

  .container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 80px 15px 15px 15px; /* уменьшил отступы */
  }
  
  .header {
    background: var(--bg-card);
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 20px;
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    border: 1px solid var(--border);
  }
  
  .header-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 30px;
    flex-wrap: wrap;
  }
  
  .user-info {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  
  .profile-pic { 
    width: 80px; 
    height: 80px; 
    border-radius: 50%; 
    object-fit: cover; 
    background: var(--bg-dark);
    border: 3px solid var(--primary);
    box-shadow: 0 0 20px rgba(145, 70, 255, 0.3);
  }
  
  .user-details h1 { 
    margin: 0 0 6px; 
    font-size: 24px; 
    font-weight: 700;
    background: linear-gradient(135deg, var(--primary), var(--secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .user-details p { 
    margin: 0; 
    color: var(--text-secondary);
    font-size: 14px;
  }
  
  .avatar-preview {
    position: relative;
    width: 100px;
    height: 100px;
    background: var(--bg-dark);
    border-radius: 12px;
    padding: 8px;
    border: 2px solid var(--border);
    box-shadow: 0 8px 25px rgba(0,0,0,.3);
  }
  
  .avatar { 
    position: relative; 
    width: 100%; 
    height: 100%; 
    background: transparent; 
  }
  
  .avatar .layer { 
    position: absolute; 
    inset: 0; 
    width: 100%; 
    height: 100%;
    display: block; 
    object-fit: contain; 
    image-rendering: -webkit-optimize-contrast;
    border-radius: 0 !important; 
    pointer-events: none; 
  }
  
  .avatar .layer.body { z-index: 1; }
  .avatar .layer.face { z-index: 2; }
  .avatar .layer.clothes { z-index: 3; }
  .avatar .layer.others { z-index: 4; }
  
  .main-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 20px;
  }
  
  .left-column {
    display: flex;
    flex-direction: column;
    gap: 15px;
    justify-content: space-between;
  }
  
  .right-column {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  
  .left-column .card {
    flex: 0 0 auto;
    padding: 20px;
  }
  
  .right-column .card {
    flex: 1;
  }
  
  .card {
    background: var(--bg-card);
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    border: 1px solid var(--border);
    transition: all 0.3s ease;
  }
  
  .card:hover {
    transform: translateY(-2px);
    box-shadow: 0 15px 40px rgba(0,0,0,.4);
  }
  
  .card h2 {
    margin: 0 0 15px;
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
  }
  
  .actions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }
  
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 16px;
    border: none;
    border-radius: 10px;
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, var(--primary), var(--primary-dark));
    color: white;
    box-shadow: 0 4px 15px rgba(145, 70, 255, 0.3);
  }
  
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(145, 70, 255, 0.4);
  }
  
  .btn-secondary {
    background: var(--bg-card-hover);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
  
  .btn-secondary:hover {
    background: var(--border-light);
    transform: translateY(-1px);
  }
  
  .btn-copy {
    background: linear-gradient(135deg, #6b7280, #4b5563);
    color: white;
  }
  
  .btn-copy:hover {
    box-shadow: 0 8px 25px rgba(107, 114, 128, 0.3);
  }
  
  .overlay-info {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  
  .overlay-url-container {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  
  .overlay-url-container label {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 14px;
  }
  
  .url-input-group {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  
  .url-input {
    flex: 1;
    padding: 12px 16px;
    border: 2px solid var(--border);
    border-radius: 8px;
    background: var(--bg-dark);
    color: var(--text-primary);
    font-family: 'Courier New', monospace;
    font-size: 14px;
  }
  
  .url-input:focus {
    outline: none;
    border-color: var(--primary);
  }
  
  .overlay-instructions {
    background: var(--bg-dark);
    padding: 15px;
    border-radius: 10px;
    border: 1px solid var(--border);
  }
  
  .overlay-instructions h4 {
    margin: 0 0 10px 0;
    color: var(--text-primary);
    font-size: 14px;
  }
  
  .overlay-instructions ol {
    margin: 0;
    padding-left: 18px;
    color: var(--text-secondary);
    line-height: 1.4;
    font-size: 13px;
  }
  
  .overlay-instructions li {
    margin-bottom: 6px;
  }
  
  .overlay-instructions code {
    background: var(--bg-card);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    color: var(--primary);
    font-size: 13px;
  }
  
  .btn-success {
    background: linear-gradient(135deg, var(--accent), #059669);
    color: white;
    box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
  }
  
  .btn-warning {
    background: linear-gradient(135deg, var(--warning), #d97706);
    color: white;
    box-shadow: 0 4px 15px rgba(245, 158, 11, 0.3);
  }
  
  .btn-danger {
    background: linear-gradient(135deg, var(--danger), #dc2626);
    color: white;
    box-shadow: 0 4px 15px rgba(239, 68, 68, 0.3);
  }
  
  .btn-orange {
    background: linear-gradient(135deg, #ff6b35, #f7931e);
    color: white;
    box-shadow: 0 4px 15px rgba(255, 107, 53, 0.3);
  }
  
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none !important;
  }
  
  .status-indicator {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
  }
  
  .status-online {
    background: rgba(16, 185, 129, 0.2);
    color: var(--accent);
    border: 1px solid var(--accent);
  }
  
  .status-offline {
    background: rgba(239, 68, 68, 0.2);
    color: var(--danger);
    border: 1px solid var(--danger);
  }
  
  .instructions {
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 12px;
    padding: 20px;
    margin-top: 20px;
  }
  
  .instructions h3 {
    margin: 0 0 15px;
    color: #3b82f6;
    font-size: 18px;
  }
  
  .instructions p {
    margin: 0 0 10px;
    color: var(--text-secondary);
    font-size: 14px;
  }
  
  .instructions code {
    background: var(--bg-dark);
    padding: 4px 8px;
    border-radius: 6px;
    font-family: 'Courier New', monospace;
    color: var(--accent);
    font-size: 13px;
  }
  
  .hidden { display: none; }
  
  .loading {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--text-secondary);
    font-style: italic;
  }
  
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top: 2px solid var(--primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  @media (max-width: 768px) {
    .main-content {
      grid-template-columns: 1fr;
    }
    
    .header-content {
      flex-direction: column;
      text-align: center;
    }
    
    .actions-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
<body>
  <nav class="navbar">
    <div class="nav-container">
      <div class="nav-brand">
        <span class="nav-icon">🎭</span>
        <span class="nav-title">Avatar System</span>
      </div>
      <div class="nav-links">
        <a href="/logout" class="nav-link">
          <span>🚪</span>
          Выйти
        </a>
      </div>
    </div>
  </nav>

  <div class="container">
    <div class="header">
      <div class="header-content">
        <div class="user-info">
          <img class="profile-pic" src="${avatar}" alt="Profile">
          <div class="user-details">
            <h1>Добро пожаловать!</h1>
        <p><b>${name}</b> ${login ? `(@${login})` : ''}</p>
          </div>
        </div>
        <div class="avatar-preview">
          <div id="avatar" class="avatar" aria-label="Аватар по слоям">
            <img class="layer body" alt="body" src="/parts/body/${avatarData?.body_skin || 'body_skin_1'}.png">
            <img class="layer face" alt="face" src="/parts/face/${avatarData?.face_skin || 'face_skin_1'}.png">
            <img class="layer clothes" alt="clothes" src="/parts/clothes/${avatarData?.clothes_type || 'clothes_type_1'}.png">
            <img class="layer others" alt="others" src="/parts/others/${avatarData?.others_type || 'others_1'}.png">
          </div>
        </div>
      </div>
    </div>

    <div class="main-content">
      <div class="left-column">
        <div class="card">
          <h2>🎮 Управление аватаром</h2>
          <div class="actions-grid">
            <a class="btn btn-primary" href="/my-avatar">
              <span>👤</span>
              Мой аватар
            </a>
            <a class="btn btn-secondary" href="/my-chat">
              <span>💬</span>
              Мой чат
            </a>
          </div>
        </div>

        <div class="card">
          <h2>🤖 Управление ботом</h2>
          <div class="actions-grid">
            <button class="btn btn-success" id="toggleBotBtn">
              <span>▶️</span>
              Подключить бота
            </button>
          </div>
          <div id="botStatus" class="status-indicator status-offline">
            <span>●</span>
            <span>Бот отключен</span>
          </div>
        </div>

        

        <div class="card">
          <h2>💰 DonationAlerts</h2>
          <div class="actions-grid">
            <button class="btn btn-orange" id="connectDABtn">
              <span>🔗</span>
              Подключить DonationAlerts
            </button>
          </div>
          <div id="daStatus" class="status-indicator status-offline">
            <span>●</span>
            <span>DonationAlerts отключен</span>
          </div>
        </div>
      </div>

      <div class="right-column">
        <div class="card">
          <h2>📺 OBS Overlay</h2>
          <div class="overlay-info">
            <div class="overlay-url-container">
              <label for="overlayUrl">Ссылка для OBS Browser Source:</label>
              <div class="url-input-group">
                <input type="text" id="overlayUrl" readonly value="/overlay.html?streamer_id=${uid}" class="url-input">
                <button class="btn btn-copy" id="copyUrlBtn">
                  <span>📋</span>
                  Копировать
                </button>
                <button class="btn btn-primary" id="testOverlayBtn">
                  <span>👁️</span>
                  Предпросмотр
                </button>
              </div>
            </div>
            <div class="overlay-instructions">
              <h4>📋 Инструкция для OBS:</h4>
              <ol>
                <li>Добавьте источник "Browser Source"</li>
                <li>Вставьте ссылку: <code>/overlay.html</code></li>
                <li>Установите размер: 1920x1080</li>
                <li>Включите "Shutdown source when not visible"</li>
                <li>Включите "Refresh browser when scene becomes active"</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>


    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
        <a class="btn btn-secondary" href="/">
          <span>🏠</span>
          На главную
        </a>
        <button class="btn btn-danger" id="logoutBtn">
          <span>🚪</span>
          Выход
        </button>
      </div>
    </div>
  </div>

  <script>
    // Состояние компонентов
    let botStatus = { running: false };
    let daStatus = { connected: false, needs_reauth: false };
    
    // Функция показа уведомления
    function showNotification(message, type = 'info') {
      const notification = document.createElement('div');
      notification.style.cssText = \`
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 12px;
        color: white;
        font-weight: 600;
        z-index: 1000;
        animation: slideIn 0.3s ease-out;
        max-width: 400px;
        box-shadow: 0 8px 25px rgba(0,0,0,0.3);
      \`;
      
      const colors = {
        success: 'linear-gradient(135deg, #10b981, #059669)',
        error: 'linear-gradient(135deg, #ef4444, #dc2626)',
        warning: 'linear-gradient(135deg, #f59e0b, #d97706)',
        info: 'linear-gradient(135deg, #3b82f6, #1d4ed8)'
      };
      
      notification.style.background = colors[type] || colors.info;
      notification.textContent = message;
      
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => notification.remove(), 300);
      }, 4000);
    }
    
    // CSS для анимаций уведомлений и адаптивного дизайна
    const style = document.createElement('style');
    style.textContent = \`
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
      
      /* Responsive Design */
      @media (max-width: 768px) {
        .container {
          padding: 20px;
        }
        
        .header {
          flex-direction: column;
          gap: 20px;
          text-align: center;
        }
        
        .header-left {
          flex-direction: column;
          align-items: center;
        }
        
        .avatar-preview {
          margin: 0;
        }
        
        .main-content {
          grid-template-columns: 1fr;
          gap: 20px;
        }
        
        .left-column,
        .right-column {
          gap: 15px;
        }
        
        .card {
          padding: 20px;
        }
        
        .card h3 {
          font-size: 1.3rem;
        }
        
        .actions {
          flex-direction: column;
          gap: 10px;
        }
        
        .btn {
          width: 100%;
          justify-content: center;
        }
        
        .notification {
          right: 10px;
          left: 10px;
          max-width: none;
        }
      }
      
      @media (max-width: 480px) {
        .header h1 {
          font-size: 1.8rem;
        }
        
        .card h3 {
          font-size: 1.2rem;
        }
        
        .card p {
          font-size: 0.9rem;
        }
      }
    \`;
    document.head.appendChild(style);


    // Загрузка статуса бота
    async function loadBotStatus() {
      try {
        const response = await fetch('/bot/status');
        if (response.ok) {
          const data = await response.json();
          botStatus = data;
          updateBotStatusDisplay();
        }
      } catch (error) {
        console.error('Error loading bot status:', error);
      }
    }

    // Обновление отображения статуса бота
    function updateBotStatusDisplay() {
      const statusEl = document.getElementById('botStatus');
      const btn = document.getElementById('toggleBotBtn');
      if (botStatus.running) {
        statusEl.className = 'status-indicator status-online';
        statusEl.innerHTML = '<span>●</span><span>Бот активен</span>';
        if (btn) {
          btn.className = 'btn btn-danger';
          btn.innerHTML = '<span>⏹️</span> Отключить бота';
        }
      } else {
        statusEl.className = 'status-indicator status-offline';
        statusEl.innerHTML = '<span>●</span><span>Бот отключен</span>';
        if (btn) {
          btn.className = 'btn btn-success';
          btn.innerHTML = '<span>▶️</span> Подключить бота';
        }
      }
    }

    // Загрузка статуса DonationAlerts
    async function loadDAStatus() {
      try {
        const response = await fetch('/api/donationalerts/status');
        if (response.ok) {
          daStatus = await response.json();
          updateDAStatusDisplay();
        }
      } catch (error) {
        console.error('Error loading DA status:', error);
      }
    }

    // Обновление отображения статуса DonationAlerts
    function updateDAStatusDisplay() {
      const statusEl = document.getElementById('daStatus');
      const btn = document.getElementById('connectDABtn');
      
      if (daStatus.connected) {
        statusEl.className = 'status-indicator status-online';
        statusEl.innerHTML = '<span>●</span><span>DonationAlerts подключен</span>';
        btn.innerHTML = '<span>🔗</span> Отключить DonationAlerts';
        btn.className = 'btn btn-danger';
      } else if (daStatus.needs_reauth) {
        statusEl.className = 'status-indicator status-offline';
        statusEl.innerHTML = '<span>●</span><span>Требуется переподключение</span>';
        btn.innerHTML = '<span>🔄</span> Переподключить DonationAlerts';
        btn.className = 'btn btn-warning';
      } else {
        statusEl.className = 'status-indicator status-offline';
        statusEl.innerHTML = '<span>●</span><span>DonationAlerts отключен</span>';
        btn.innerHTML = '<span>🔗</span> Подключить DonationAlerts';
        btn.className = 'btn btn-orange';
      }
    }

    // Обработчики кнопок
    document.getElementById('toggleBotBtn').onclick = async () => {
      const btn = document.getElementById('toggleBotBtn');
      const originalText = btn.innerHTML;
      try {
        if (botStatus.running) {
          btn.innerHTML = '<span>⏳</span> Отключение...';
          btn.disabled = true;
          const response = await fetch('/bot/stop', { method: 'POST' });
          const text = await response.text();
          if (response.ok) {
            showNotification('✅ ' + text, 'success');
            botStatus.running = false;
            updateBotStatusDisplay();
          } else {
            showNotification('❌ ' + text, 'error');
          }
        } else {
          btn.innerHTML = '<span>⏳</span> Подключение...';
          btn.disabled = true;
          const response = await fetch('/bot/start', { method: 'POST' });
          const text = await response.text();
          if (response.ok) {
            showNotification('✅ ' + text, 'success');
            botStatus.running = true;
            updateBotStatusDisplay();
          } else {
            showNotification('❌ ' + text, 'error');
          }
        }
      } catch (error) {
        showNotification('❌ Ошибка: ' + error.message, 'error');
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    };

    // (кнопки запуска игр убраны на этой странице)


    // DonationAlerts connection
    document.getElementById('connectDABtn').onclick = async () => {
      const btn = document.getElementById('connectDABtn');
      const originalText = btn.innerHTML;
      
      try {
      if (daStatus.connected) {
        // Disconnect
          btn.innerHTML = '<span>⏳</span> Отключение...';
          btn.disabled = true;
          
          const response = await fetch('/api/donationalerts/disconnect', { method: 'POST' });
          const data = await response.json();
          
          if (response.ok) {
            showNotification('✅ ' + data.message, 'success');
            daStatus.connected = false;
            updateDAStatusDisplay();
          } else {
            showNotification('❌ ' + data.error, 'error');
        }
      } else {
        // Connect via OAuth
        window.location = '/auth/donationalerts';
        }
      } catch (error) {
        showNotification('❌ Ошибка: ' + error.message, 'error');
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    };

    // Test overlay
    // Копирование URL для OBS
    document.getElementById('copyUrlBtn').onclick = async () => {
      const uid = '${uid}';
      const fullUrl = window.location.protocol + '//' + window.location.host + '/overlay.html?streamer_id=' + uid;
      
      try {
        await navigator.clipboard.writeText(fullUrl);
        showNotification('📋 URL скопирован в буфер обмена!', 'success');
      } catch (err) {
        // Fallback для старых браузеров
        const urlInput = document.getElementById('overlayUrl');
        urlInput.value = fullUrl;
        urlInput.select();
        document.execCommand('copy');
        showNotification('📋 URL скопирован в буфер обмена!', 'success');
      }
    };

    // Предпросмотр overlay
    document.getElementById('testOverlayBtn').onclick = () => {
      const uid = '${uid}';
      const overlayUrl = window.location.protocol + '//' + window.location.host + '/overlay.html?streamer_id=' + uid;
      window.open(overlayUrl, '_blank');
      showNotification('👁️ Overlay открыт в новой вкладке', 'info');
    };

    // Test donation

    // Logout
    document.getElementById('logoutBtn').onclick = async () => {
      if (confirm('Вы уверены, что хотите выйти?')) {
        try { 
          await fetch('/auth/logout', { method: 'POST' }); 
        } catch(_) {}
      window.location = '/';
      }
    };

    // Check if DA was just connected
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('da_connected') === 'true') {
      showNotification('✅ DonationAlerts успешно подключен!', 'success');
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Загружаем статусы при загрузке страницы
    document.addEventListener('DOMContentLoaded', async () => {
      await Promise.all([
        loadBotStatus(),
        loadDAStatus()
      ]);
    });
  </script>
</body>
</html>
    `);
  });
}

module.exports = { registerSuccessRoute };


