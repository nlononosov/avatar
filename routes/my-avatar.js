const { getUserByTwitchId, getAvatarByTwitchId, getUserGifts, getUserGiftStats, getAvailableGifts, updateAvatarPart, getUserCoins, addUserCoins, getLockedSkins, getUserPurchasedSkins, isSkinPurchased, purchaseSkin, getSkinPrice, getAllSkinsWithPrices, updateSkinPrice, bulkUpdateSkinPrices, getGiftInfo } = require('../db');

function registerMyAvatarRoute(app) {

  // API для получения монет пользователя
  app.get('/api/user/coins', (req, res) => {
    const uid = req.session.userId;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const coins = getUserCoins(uid);
      res.json({
        success: true,
        data: { coins }
      });
    } catch (error) {
      console.error('Error getting user coins:', error);
      res.status(500).json({ error: 'Failed to get coins' });
    }
  });

  // API для создания платежа через ЮKassa
  app.post('/api/payment/create', async (req, res) => {
    const uid = req.session.userId;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { amount } = req.body;
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      return res.status(400).json({ error: 'Invalid amount. Must be a positive integer.' });
    }

    if (amount > 10000) {
      return res.status(400).json({ error: 'Maximum amount is 10,000 coins per transaction.' });
    }

    if (amount < 1) {
      return res.status(400).json({ error: 'Minimum amount is 1 coin (1 ruble).' });
    }

    try {
      const { createPayment } = require('../lib/yookassa');
      const paymentUrl = await createPayment(uid, amount);
      
      res.json({
        success: true,
        data: { 
          paymentUrl: paymentUrl,
          amount: amount
        }
      });
    } catch (error) {
      console.error('Error creating payment:', error);
      res.status(500).json({ error: error.message || 'Failed to create payment' });
    }
  });

  // API для обработки успешного платежа (callback от ЮKassa)
  app.post('/api/payment/success', (req, res) => {
    const { userId, amount, paymentId } = req.body;
    
    if (!userId || !amount || !paymentId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    try {
      // Проверяем, что платеж еще не был обработан
      const { isPaymentProcessed, markPaymentProcessed } = require('../lib/yookassa');
      if (isPaymentProcessed(paymentId)) {
        return res.json({ success: true, message: 'Payment already processed' });
      }

      // Начисляем монеты
      const newCoins = addUserCoins(userId, amount);
      
      // Отмечаем платеж как обработанный
      markPaymentProcessed(paymentId);
      
      res.json({
        success: true,
        data: { 
          newCoins: newCoins,
          addedCoins: amount,
          message: `Баланс пополнен на ${amount} монет!`
        }
      });
    } catch (error) {
      console.error('Error processing payment:', error);
      res.status(500).json({ error: 'Failed to process payment' });
    }
  });

  // API для пополнения баланса (оставляем для совместимости)
  app.post('/api/user/add-coins', (req, res) => {
    const uid = req.session.userId;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { amount } = req.body;
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      return res.status(400).json({ error: 'Invalid amount. Must be a positive integer.' });
    }

    if (amount > 10000) {
      return res.status(400).json({ error: 'Maximum amount is 10,000 coins per transaction.' });
    }

    try {
      const newCoins = addUserCoins(uid, amount);
      
      res.json({
        success: true,
        data: { 
          newCoins: newCoins,
          addedCoins: amount,
          message: `Баланс пополнен на ${amount} монет!`
        }
      });
    } catch (error) {
      console.error('Error adding coins:', error);
      res.status(500).json({ error: 'Failed to add coins' });
    }
  });

  // API для покупки скина
  app.post('/api/skin/purchase', (req, res) => {
    const uid = req.session.userId;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { skinType, skinId } = req.body;
    if (!skinType || !skinId) {
      return res.status(400).json({ error: 'Missing skinType or skinId' });
    }

    try {
      const price = getSkinPrice(skinType, skinId);
      if (price === 0) {
        return res.status(400).json({ error: 'Skin not found or not locked' });
      }

      const result = purchaseSkin(uid, skinType, skinId, price);
      
      if (result.success) {
        res.json({
          success: true,
          data: { 
            newCoins: result.newCoins,
            message: 'Скин успешно куплен!'
          }
        });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error('Error purchasing skin:', error);
      res.status(500).json({ error: 'Failed to purchase skin' });
    }
  });

  // API для получения информации о подарках
  app.get('/api/gifts/info', (req, res) => {
    try {
      const { giftType, giftId } = req.query;
      
      if (!giftType || !giftId) {
        return res.status(400).json({ error: 'Missing giftType or giftId' });
      }

      const giftInfo = getGiftInfo(giftType, giftId);
      res.json({
        success: true,
        data: giftInfo
      });
    } catch (error) {
      console.error('Error getting gift info:', error);
      res.status(500).json({ error: 'Failed to get gift info' });
    }
  });

  // API для получения информации о заблокированных скинах
  app.get('/api/skins/locked', (req, res) => {
    const uid = req.session.userId;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const lockedSkins = getLockedSkins();
      const purchasedSkins = getUserPurchasedSkins(uid);
      const purchasedSet = new Set(purchasedSkins.map(s => `${s.skin_type}_${s.skin_id}`));
      
      const skinsWithStatus = lockedSkins.map(skin => ({
        ...skin,
        isPurchased: purchasedSet.has(`${skin.skin_type}_${skin.skin_id}`)
      }));

      res.json({
        success: true,
        data: skinsWithStatus
      });
    } catch (error) {
      console.error('Error getting locked skins:', error);
      res.status(500).json({ error: 'Failed to get locked skins' });
    }
  });

  // API для получения всех скинов с ценами (для админки)
  app.get('/api/admin/skins', (req, res) => {
    const uid = req.session.userId;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const allSkins = getAllSkinsWithPrices();
      res.json({
        success: true,
        data: allSkins
      });
    } catch (error) {
      console.error('Error getting all skins:', error);
      res.status(500).json({ error: 'Failed to get skins' });
    }
  });

  // API для обновления цены скина
  app.post('/api/admin/skin/price', (req, res) => {
    const uid = req.session.userId;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { skinType, skinId, price, isLocked } = req.body;
    if (!skinType || !skinId || price === undefined) {
      return res.status(400).json({ error: 'Missing skinType, skinId or price' });
    }

    try {
      const result = updateSkinPrice(skinType, skinId, price, isLocked);
      
      if (result.success) {
        res.json({
          success: true,
          message: 'Цена скина обновлена'
        });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error('Error updating skin price:', error);
      res.status(500).json({ error: 'Failed to update skin price' });
    }
  });

  // API для массового обновления цен
  app.post('/api/admin/skins/bulk-update', (req, res) => {
    const uid = req.session.userId;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { skins } = req.body;
    if (!Array.isArray(skins)) {
      return res.status(400).json({ error: 'Skins must be an array' });
    }

    try {
      const results = bulkUpdateSkinPrices(skins);
      res.json({
        success: true,
        data: results,
        message: `Обновлено ${results.updated} скинов`
      });
    } catch (error) {
      console.error('Error bulk updating skin prices:', error);
      res.status(500).json({ error: 'Failed to update skin prices' });
    }
  });

  // Админ-страница для управления ценами скинов
  app.get('/admin/skins', (req, res) => {
    const uid = req.session.userId;
    if (!uid) {
      return res.redirect('/');
    }

    const user = getUserByTwitchId(uid);
    if (!user) {
      return res.redirect('/');
    }

    // Проверяем, что это админ (только @1_tosik_1)
    if (user.login !== '1_tosik_1') {
      return res.status(403).send(`
<!doctype html>
<html lang="ru">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Доступ запрещен</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display: flex; align-items: center; justify-content: center; }
  .container { text-align: center; padding: 40px; }
  .error-icon { font-size: 64px; margin-bottom: 20px; }
  h1 { color: #f87171; margin-bottom: 20px; }
  p { color: #9ca3af; margin-bottom: 30px; }
  .back-btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; height: 48px; padding: 0 18px; background: #7c3aed; color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 16px; }
  .back-btn:hover { background: #6d28d9; }
</style>
<body>
  <div class="container">
    <div class="error-icon">🚫</div>
    <h1>Доступ запрещен</h1>
    <p>У вас нет прав для доступа к админ-панели</p>
    <a href="/my-avatar" class="back-btn">← Назад к аватару</a>
  </div>
</body>
</html>
      `);
    }

    const { displayName, login } = user;

    res.send(`
<!doctype html>
<html lang="ru">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Управление ценами скинов</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; }
  .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 30px; }
  .header h1 { margin: 0; font-size: 28px; }
  .back-btn { display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; text-decoration: none; height: 48px; padding: 0 18px; background: #7c3aed; color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 16px; }
  .back-btn:hover { background: #6d28d9; }
  
  .admin-section { background: #111827; padding: 30px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,.35); margin-bottom: 20px; }
  .admin-section h2 { margin: 0 0 20px; font-size: 22px; }
  
  .skins-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
  .skin-card { background: #1f2937; padding: 20px; border-radius: 12px; border: 2px solid #374151; }
  .skin-card.locked { border-color: #fbbf24; }
  .skin-preview { width: 80px; height: 80px; margin: 0 auto 15px; background: #374151; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
  .skin-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .skin-info h3 { margin: 0 0 10px; font-size: 16px; color: #f1f5f9; }
  .skin-type { font-size: 12px; color: #9ca3af; margin-bottom: 10px; }
  .price-input { width: 100%; padding: 8px 12px; background: #374151; border: 1px solid #6b7280; border-radius: 6px; color: #f1f5f9; font-size: 14px; margin-bottom: 10px; }
  .price-input:focus { outline: none; border-color: #7c3aed; }
  .lock-checkbox { display: flex; align-items: center; gap: 8px; margin-bottom: 15px; }
  .lock-checkbox input[type="checkbox"] { width: 16px; height: 16px; }
  .lock-checkbox label { font-size: 14px; color: #e2e8f0; }
  .btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; height: 36px; padding: 0 16px; background: #7c3aed; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; }
  .btn:hover { background: #6d28d9; }
  .btn.secondary { background: #374151; }
  .btn.secondary:hover { background: #4b5563; }
  .btn.save { background: #10b981; }
  .btn.save:hover { background: #059669; }
  
  .bulk-actions { display: flex; gap: 15px; margin-bottom: 20px; }
  .bulk-actions .btn { height: 48px; padding: 0 24px; font-size: 16px; }
  
  .status-message { padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-weight: 600; }
  .status-message.success { background: #065f46; color: #10b981; border: 1px solid #10b981; }
  .status-message.error { background: #7f1d1d; color: #f87171; border: 1px solid #f87171; }
  
  .loading { text-align: center; padding: 40px; opacity: 0.8; }
</style>
<body>
  <div class="container">
    <a href="/my-avatar" class="back-btn">← Назад к аватару</a>
    
    <div class="header">
      <h1>Управление ценами скинов</h1>
      <div>
        <p><b>${displayName}</b> ${login ? `(@${login})` : ''}</p>
      </div>
    </div>

    <div class="admin-section">
      <h2>Массовые действия</h2>
      <div class="bulk-actions">
        <button class="btn" onclick="loadSkins()">🔄 Обновить</button>
        <button class="btn save" onclick="saveAllChanges()">💾 Сохранить все изменения</button>
        <button class="btn secondary" onclick="resetAllChanges()">↩️ Сбросить изменения</button>
      </div>
    </div>

    <div class="admin-section">
      <h2>Все скины</h2>
      <div id="skinsContainer" class="loading">
        Загрузка скинов...
      </div>
    </div>
  </div>

  <script>
    let allSkins = [];
    let modifiedSkins = new Set();

    // Загрузка всех скинов
    async function loadSkins() {
      try {
        const response = await fetch('/api/admin/skins');
        const data = await response.json();
        
        if (data.success) {
          allSkins = data.data;
          renderSkins();
        } else {
          showMessage('Ошибка загрузки скинов: ' + data.error, 'error');
        }
      } catch (error) {
        console.error('Error loading skins:', error);
        showMessage('Ошибка загрузки скинов', 'error');
      }
    }

    // Отображение скинов
    function renderSkins() {
      const container = document.getElementById('skinsContainer');
      
      if (allSkins.length === 0) {
        container.innerHTML = '<div class="loading">Скины не найдены</div>';
        return;
      }

      // Группируем скины по типам
      const groupedSkins = {};
      allSkins.forEach(skin => {
        if (!groupedSkins[skin.skinType]) {
          groupedSkins[skin.skinType] = [];
        }
        groupedSkins[skin.skinType].push(skin);
      });

      container.innerHTML = Object.keys(groupedSkins).map(skinType => {
        const typeName = skinType === 'body' ? 'Тело' : 
                        skinType === 'face' ? 'Лицо' : 
                        skinType === 'clothes' ? 'Одежда' : 'Аксессуары';
        
        return \`
          <div style="margin-bottom: 30px;">
            <h3 style="margin: 0 0 15px; color: #fbbf24; font-size: 18px;">\${typeName}</h3>
            <div class="skins-grid">
              \${groupedSkins[skinType].map(skin => \`
                <div class="skin-card \${skin.isLocked ? 'locked' : ''}" data-skin-id="\${skin.skinType}_\${skin.skinId}">
                  <div class="skin-preview">
                    <img src="\${skin.path}" alt="\${skin.name}">
                  </div>
                  <div class="skin-info">
                    <h3>\${skin.name}</h3>
                    <div class="skin-type">\${skin.skinType} - \${skin.skinId}</div>
                    <input type="number" class="price-input" 
                           value="\${skin.price}" 
                           min="0" 
                           placeholder="Цена в монетах"
                           onchange="markAsModified('\${skin.skinType}_\${skin.skinId}')">
                    <div class="lock-checkbox">
                      <input type="checkbox" 
                             \${skin.isLocked ? 'checked' : ''} 
                             onchange="markAsModified('\${skin.skinType}_\${skin.skinId}')">
                      <label>Заблокирован</label>
                    </div>
                    <button class="btn save" onclick="saveSkin('\${skin.skinType}', '\${skin.skinId}')">
                      Сохранить
                    </button>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }).join('');
    }

    // Отметить скин как измененный
    function markAsModified(skinId) {
      modifiedSkins.add(skinId);
    }

    // Сохранить отдельный скин
    async function saveSkin(skinType, skinId) {
      const card = document.querySelector(\`[data-skin-id="\${skinType}_\${skinId}"]\`);
      const priceInput = card.querySelector('.price-input');
      const lockCheckbox = card.querySelector('.lock-checkbox input');
      
      const price = parseInt(priceInput.value) || 0;
      const isLocked = lockCheckbox.checked;

      try {
        const response = await fetch('/api/admin/skin/price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skinType,
            skinId,
            price,
            isLocked
          })
        });

        const data = await response.json();
        
        if (data.success) {
          showMessage('Цена скина обновлена', 'success');
          modifiedSkins.delete(\`\${skinType}_\${skinId}\`);
          
          // Обновляем данные
          const skin = allSkins.find(s => s.skinType === skinType && s.skinId === skinId);
          if (skin) {
            skin.price = price;
            skin.isLocked = isLocked;
            skin.isLockedValue = isLocked;
          }
        } else {
          showMessage('Ошибка: ' + data.error, 'error');
        }
      } catch (error) {
        console.error('Error saving skin:', error);
        showMessage('Ошибка при сохранении скина', 'error');
      }
    }

    // Сохранить все изменения
    async function saveAllChanges() {
      if (modifiedSkins.size === 0) {
        showMessage('Нет изменений для сохранения', 'error');
        return;
      }

      const skinsToUpdate = [];
      modifiedSkins.forEach(skinId => {
        const [skinType, skinIdPart] = skinId.split('_');
        const card = document.querySelector(\`[data-skin-id="\${skinId}"]\`);
        const priceInput = card.querySelector('.price-input');
        const lockCheckbox = card.querySelector('.lock-checkbox input');
        
        skinsToUpdate.push({
          skinType,
          skinId: skinIdPart,
          price: parseInt(priceInput.value) || 0,
          isLocked: lockCheckbox.checked
        });
      });

      try {
        const response = await fetch('/api/admin/skins/bulk-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skins: skinsToUpdate })
        });

        const data = await response.json();
        
        if (data.success) {
          showMessage(data.message, 'success');
          modifiedSkins.clear();
          
          // Обновляем данные
          skinsToUpdate.forEach(updatedSkin => {
            const skin = allSkins.find(s => s.skinType === updatedSkin.skinType && s.skinId === updatedSkin.skinId);
            if (skin) {
              skin.price = updatedSkin.price;
              skin.isLocked = updatedSkin.isLocked;
              skin.isLockedValue = updatedSkin.isLocked;
            }
          });
        } else {
          showMessage('Ошибка: ' + data.error, 'error');
        }
      } catch (error) {
        console.error('Error bulk saving:', error);
        showMessage('Ошибка при сохранении изменений', 'error');
      }
    }

    // Сбросить все изменения
    function resetAllChanges() {
      modifiedSkins.clear();
      loadSkins();
      showMessage('Изменения сброшены', 'success');
    }

    // Показать сообщение
    function showMessage(message, type) {
      const existingMessage = document.querySelector('.status-message');
      if (existingMessage) {
        existingMessage.remove();
      }

      const messageDiv = document.createElement('div');
      messageDiv.className = \`status-message \${type}\`;
      messageDiv.textContent = message;
      
      const container = document.querySelector('.container');
      container.insertBefore(messageDiv, container.children[1]);
      
      setTimeout(() => {
        messageDiv.remove();
      }, 5000);
    }

    // Загружаем скины при загрузке страницы
    loadSkins();
  </script>
</body>
</html>
    `);
  });

  app.get('/my-avatar', (req, res) => {
    const uid = req.session.userId;
    if (!uid) {
      return res.redirect('/');
    }

    const user = getUserByTwitchId(uid);
    if (!user) {
      return res.redirect('/');
    }

    const avatar = getAvatarByTwitchId(uid);
    // Для my-avatar используем uid как streamer_id (пользователь = стример)
    const gifts = getUserGifts(uid, uid);
    const giftStats = getUserGiftStats(uid, uid);
    const availableGifts = getAvailableGifts();
    
    console.log('Server: Raw gifts data:', gifts);

    // Добавляем названия подарков к данным
    const giftsWithNames = gifts.map(gift => {
      // Извлекаем номер подарка из полного ID
      const giftId = gift.gift_id.replace(`gift_${gift.gift_type}_`, '');
      const giftInfo = getGiftInfo(gift.gift_type, giftId);
      console.log('Server: Creating gift with name:', { 
        originalGiftId: gift.gift_id, 
        giftType: gift.gift_type, 
        extractedGiftId: giftId, 
        giftName: giftInfo.name 
      });
      return {
        ...gift,
        name: giftInfo.name,
        description: giftInfo.description
      };
    });
    
    console.log('Server: Gifts with names:', giftsWithNames);
    
    // Проверяем содержимое таблицы gifts
    const { db } = require('../db');
    const allGiftsFromDB = db.prepare('SELECT * FROM gifts').all();
    console.log('Server: All gifts from DB:', allGiftsFromDB);

    // Создаем объект с названиями всех подарков для клиентского кода
    const giftNames = {};
    ['common', 'uncommon', 'rare'].forEach(giftType => {
      giftNames[giftType] = {};
      for (let i = 1; i <= 10; i++) { // Предполагаем максимум 10 подарков каждого типа
        const giftInfo = getGiftInfo(giftType, i.toString());
        giftNames[giftType][i.toString()] = giftInfo.name; // Используем строковые ключи
      }
    });

    const { displayName, login, profileImageUrl } = user;

    res.send(`
<!doctype html>
<html lang="ru">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Мой аватар - Avatar System</title>
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
  
  .container { 
    max-width: 1400px; 
    margin: 0 auto; 
    padding: 80px 15px 15px 15px; /* добавил отступ сверху для навигации */ 
  }
  
  .header { 
    background: var(--bg-card);
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 15px;
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    border: 1px solid var(--border);
  }
  
  .header-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
  }
  
  .header-left { 
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
  
  .header h1 { 
    margin: 0 0 6px; 
    font-size: 24px;
    font-weight: 700;
    background: linear-gradient(135deg, var(--primary), var(--secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .header p { 
    margin: 0; 
    color: var(--text-secondary);
    font-size: 14px;
  }
  
  .coins-counter { 
    display: flex; 
    align-items: center; 
    justify-content: center;
    gap: 8px; 
    background: linear-gradient(135deg, var(--secondary), #f59e0b); 
    color: #1f2937; 
    padding: 10px 16px; 
    border-radius: 20px; 
    font-weight: 700; 
    font-size: 16px;
    box-shadow: 0 6px 20px rgba(251, 191, 36, 0.3);
    border: 2px solid #f59e0b;
    transition: all 0.3s ease;
    font-family: 'Courier New', monospace;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    min-width: 120px;
  }
  
  .coins-counter:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 30px rgba(251, 191, 36, 0.4);
  }
  
  .coins-counter::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
    transition: left 0.5s;
  }
  
  .coins-counter:hover::before {
    left: 100%;
  }
  
  #coinsAmount {
    transition: transform 0.2s ease;
    position: relative;
    z-index: 1;
  }
  
  .coins-icon { 
    font-size: 20px; 
    animation: coinSpin 3s ease-in-out infinite; 
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  @keyframes coinSpin {
    0%, 100% { transform: rotateY(0deg) scale(1); }
    25% { transform: rotateY(90deg) scale(1.1); }
    50% { transform: rotateY(180deg) scale(1); }
    75% { transform: rotateY(270deg) scale(1.1); }
  }
  
  .avatar-preview { 
    position: relative; 
    width: 100px; 
    height: 100px; 
    border-radius: 20px; 
    overflow: hidden; 
    background: var(--bg-dark); 
    border: 3px solid var(--primary);
    box-shadow: 0 8px 25px rgba(145, 70, 255, 0.3);
    transition: all 0.3s ease;
  }
  
  .avatar-preview:hover {
    transform: scale(1.05);
    box-shadow: 0 12px 35px rgba(145, 70, 255, 0.4);
  }
  
  
  .avatar-preview .layer { 
    position: absolute; 
    width: 200%; 
    height: 200%; 
    object-fit: contain; 
    image-rendering: -webkit-optimize-contrast; 
  }
  
  .avatar-preview .layer.body { z-index: 1; }
  .avatar-preview .layer.face { z-index: 2; }
  .avatar-preview .layer.clothes { z-index: 3; }
  .avatar-preview .layer.others { z-index: 4; }
  
  .main-content { 
    display: grid; 
    grid-template-columns: 1fr 1fr; 
    gap: 15px; 
    margin-bottom: 15px;
  }
  
  .avatar-section { 
    background: var(--bg-card); 
    padding: 15px; 
    border-radius: 16px; 
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    border: 1px solid var(--border);
    transition: all 0.3s ease;
  }
  
  .avatar-section:hover {
    transform: translateY(-2px);
    box-shadow: 0 15px 40px rgba(0,0,0,.4);
  }
  
  .avatar-section h2 { 
    margin: 0 0 10px; 
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
  }
  
  .avatar { 
    position: relative; 
    width: 300px; 
    height: 300px; 
    background: transparent; 
    margin: 0 auto;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 8px 25px rgba(0,0,0,.3);
    border: 2px solid var(--border);
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

  .stats-section { 
    background: var(--bg-card); 
    padding: 15px; 
    border-radius: 16px; 
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    border: 1px solid var(--border);
    transition: all 0.3s ease;
  }
  
  .stats-section:hover {
    transform: translateY(-2px);
    box-shadow: 0 15px 40px rgba(0,0,0,.4);
  }
  
  .stats-section h2 { 
    margin: 0 0 10px; 
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
  }
  
  .stats-grid { 
    display: grid; 
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); 
    gap: 12px; 
    margin-bottom: 15px;
    padding: 16px;
    background: rgba(255, 255, 255, 0.01);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  
  .section-header {
    text-align: center;
    margin-bottom: 15px;
  }
  
  .section-header h2 {
    margin: 0 0 6px 0;
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 700;
  }
  
  .section-header p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 14px;
  }

  .stat-card { 
    background: var(--bg-card); 
    padding: 16px; 
    border-radius: 12px; 
    text-align: left;
    border: 1px solid var(--border);
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  
  .stat-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(135deg, var(--primary), var(--secondary));
    transform: scaleX(0);
    transition: transform 0.3s ease;
  }
  
  .stat-card:hover::before {
    transform: scaleX(1);
  }
  
  .stat-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 30px rgba(0,0,0,0.2);
    border-color: var(--primary);
  }
  
  .stat-icon {
    font-size: 32px;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--primary), var(--primary-dark));
    border-radius: 12px;
    flex-shrink: 0;
  }
  
  .stat-info {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  
  .stat-value { 
    font-size: 32px; 
    font-weight: 700; 
    color: var(--text-primary);
    margin-bottom: 6px;
    line-height: 1;
    padding-right: 4px;
  }
  
  .stat-label { 
    font-size: 16px; 
    color: var(--text-primary);
    font-weight: 600;
    margin-bottom: 4px;
    padding-right: 4px;
    line-height: 1.2;
  }
  
  .stat-description { 
    font-size: 14px; 
    color: var(--text-secondary);
    font-weight: 500;
    padding-right: 4px;
    line-height: 1.3;
  }
  
  .stat-total .stat-icon {
    background: linear-gradient(135deg, #10b981, #059669);
  }
  
  .stat-total-count .stat-icon {
    background: linear-gradient(135deg, #f59e0b, #d97706);
  }
  
  .stat-unique .stat-icon {
    background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  }
  
  .stat-common .stat-icon {
    background: linear-gradient(135deg, #6b7280, #4b5563);
  }
  
  .stat-uncommon .stat-icon {
    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  }
  
  .stat-rare .stat-icon {
    background: linear-gradient(135deg, #f59e0b, #d97706);
  }
  
  /* Responsive Design */
  @media (max-width: 768px) {
    .container {
      padding: 20px;
    }
    
    .header-content {
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
      gap: 15px;
    }
    
    .stats-grid {
      grid-template-columns: 1fr;
      gap: 12px;
    }
    
    .stat-card {
      padding: 16px;
    }
    
    .stat-value {
      font-size: 24px;
    }
    
    .btn {
      width: 100%;
      justify-content: center;
    }
    
    .modal-content {
      margin: 1% auto;
      padding: 15px;
      width: 98%;
      max-height: 98vh;
    }
    
    .customize-grid {
      grid-template-columns: 1fr;
      gap: 15px;
    }
    
    .options-grid {
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 10px;
    }
    
    .option-item img {
      width: 50px;
      height: 50px;
    }
  }
  
  @media (max-width: 480px) {
    .header h1 {
      font-size: 1.8rem;
    }
    
    .stat-card {
      padding: 16px;
      gap: 12px;
    }
    
    .stat-icon {
      width: 40px;
      height: 40px;
      font-size: 24px;
    }
    
    .stat-value {
      font-size: 24px;
    }
    
    .stat-label {
      font-size: 14px;
    }
    
    .stat-description {
      font-size: 12px;
    }
    
    .modal-content {
      margin: 0.5% auto;
      padding: 10px;
      width: 99%;
      max-height: 99vh;
    }
    
    .modal-header h2 {
      font-size: 18px;
    }
    
    .customize-grid {
      gap: 12px;
    }
    
    .layer-section {
      padding: 12px;
    }
    
    .layer-section h3 {
      font-size: 14px;
      margin-bottom: 10px;
    }
    
    .options-grid {
      grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
      gap: 8px;
    }
    
    .option-item {
      padding: 6px;
    }
    
    .option-item img {
      width: 40px;
      height: 40px;
    }
    
    .option-item .name {
      font-size: 10px;
    }
  }
  
  .stat-card.clickable { 
    cursor: pointer; 
    transition: all 0.3s ease;
  }
  
  .stat-card.clickable:hover { 
    background: var(--border-light); 
    border-color: var(--primary); 
    transform: translateY(-4px);
    box-shadow: 0 8px 25px rgba(145, 70, 255, 0.2);
  }
  
  .back-btn { 
    display: inline-flex; 
    align-items: center; 
    justify-content: center; 
    gap: 6px;
    margin-bottom: 20px; 
    text-decoration: none; 
    height: 40px; 
    padding: 0 16px; 
    background: linear-gradient(135deg, var(--primary), var(--primary-dark)); 
    color: white; 
    border: none; 
    border-radius: 10px; 
    cursor: pointer; 
    font-weight: 600; 
    font-size: 14px;
    box-shadow: 0 4px 15px rgba(145, 70, 255, 0.3);
    transition: all 0.3s ease;
  }
  
  .back-btn:hover { 
    background: linear-gradient(135deg, var(--primary-dark), #6d28d9);
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(145, 70, 255, 0.4);
  }
  
  .empty-state { text-align: center; padding: 40px; opacity: 0.6; }
  .empty-state img { width: 80px; height: 80px; opacity: 0.3; margin-bottom: 20px; }
  
  .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.8); }
  .modal-content { background-color: #111827; margin: 2% auto; padding: 20px; border-radius: 16px; width: 95%; max-width: 900px; max-height: 95vh; overflow-y: auto; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .modal-header h2 { margin: 0; font-size: 20px; }
  .close { color: #aaa; font-size: 28px; font-weight: bold; cursor: pointer; }
  .close:hover { color: white; }
  
  .modal-body { max-height: 60vh; overflow-y: auto; }
  .gifts-modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; }
  .gift-modal-item { background: #1f2937; padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #374151; }
  .gift-modal-item img { width: 60px; height: 60px; object-fit: contain; margin-bottom: 10px; }
  .gift-modal-item .gift-name { font-weight: 600; margin-bottom: 5px; color: #f1f5f9; }
  .gift-modal-item .gift-count { font-size: 12px; color: #9ca3af; }
  .gift-modal-item .gift-type { font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-top: 5px; display: inline-block; }
  .gift-modal-item .gift-type.common { background: #10b981; color: white; }
  .gift-modal-item .gift-type.uncommon { background: #3b82f6; color: white; }
  .gift-modal-item .gift-type.rare { background: #f59e0b; color: white; }
  
  .gift-modal-item { cursor: pointer; transition: all 0.2s; }
  .gift-modal-item:hover { background: #374151; border-color: #7c3aed; transform: translateY(-2px); }
  
  .gift-detail-modal { max-width: 600px; }
  .gift-detail-body { padding: 0; }
  .gift-detail-content { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .gift-image-container { background: #1f2937; border-radius: 16px; padding: 40px; margin-bottom: 30px; border: 2px solid #374151; }
  .gift-detail-image { width: 200px; height: 200px; object-fit: contain; }
  .gift-detail-info { width: 100%; }
  .gift-detail-info h3 { margin: 0 0 20px; font-size: 24px; color: #f1f5f9; }
  .gift-detail-stats { display: flex; flex-direction: column; gap: 15px; }
  .stat-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: #1f2937; border-radius: 8px; }
  .stat-label { font-weight: 600; color: #9ca3af; }
  .stat-item .gift-type { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .stat-item .gift-type.common { background: #10b981; color: white; }
  .stat-item .gift-type.uncommon { background: #3b82f6; color: white; }
  .stat-item .gift-type.rare { background: #f59e0b; color: white; }
  
  .customize-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
  .layer-section { background: #1f2937; padding: 15px; border-radius: 12px; }
  .layer-section h3 { margin: 0 0 12px; font-size: 16px; color: #fbbf24; }
  .options-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 12px; }
  .option-item { text-align: center; cursor: pointer; padding: 8px; border-radius: 8px; transition: all 0.2s; border: 2px solid transparent; position: relative; }
  .option-item:hover { background-color: #374151; border-color: #6b7280; }
  .option-item.selected { background-color: #7c3aed; border-color: #a855f7; box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.3); }
  .option-item img { width: 60px; height: 60px; object-fit: contain; margin-bottom: 6px; }
  .option-item .name { font-size: 11px; font-weight: 600; }
  .option-item.selected .name { color: white; font-weight: 700; }
  
  .option-item.locked { cursor: pointer; position: relative; }
  .option-item.locked img { filter: blur(2px) brightness(0.6); }
  .option-item.locked .lock-overlay { 
    position: absolute; 
    top: 50%; 
    left: 50%; 
    transform: translate(-50%, -50%); 
    z-index: 10;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 50%;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: #fbbf24;
    border: 2px solid #fbbf24;
  }
  .option-item.locked .price { 
    position: absolute; 
    bottom: 5px; 
    left: 50%; 
    transform: translateX(-50%); 
    background: #fbbf24; 
    color: #1f2937; 
    padding: 2px 6px; 
    border-radius: 4px; 
    font-size: 10px; 
    font-weight: 700;
    z-index: 10;
  }
  .option-item.locked:hover .lock-overlay { 
    background: rgba(0, 0, 0, 0.8); 
    border-color: #f59e0b;
    color: #f59e0b;
  }
  
  .modal-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px; }
  .btn { 
    display: inline-flex; 
    align-items: center; 
    justify-content: center; 
    text-decoration: none; 
    height: 40px; 
    padding: 0 16px; 
    background: linear-gradient(135deg, var(--primary), var(--primary-dark)); 
    color: white; 
    border: none; 
    border-radius: 10px; 
    cursor: pointer; 
    font-weight: 600; 
    font-size: 14px; 
    gap: 6px;
    transition: all 0.3s ease;
  }
  
  .btn:hover { 
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(145, 70, 255, 0.3);
  }
  
  .btn-primary {
    background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  }
  
  .btn-secondary { 
    background: linear-gradient(135deg, var(--secondary), #f59e0b);
    color: #1f2937;
  }
  
  .btn-secondary:hover {
    box-shadow: 0 8px 25px rgba(251, 191, 36, 0.3);
  }
  
  .purchase-modal { max-width: 500px; }
  .purchase-content { text-align: center; padding: 20px 0; }
  .purchase-skin-preview { 
    width: 120px; 
    height: 120px; 
    margin: 0 auto 20px; 
    position: relative;
    background: #1f2937;
    border-radius: 12px;
    padding: 10px;
  }
  .purchase-skin-preview img { 
    width: 100%; 
    height: 100%; 
    object-fit: contain; 
  }
  .purchase-info h3 { margin: 0 0 10px; color: #f1f5f9; }
  .purchase-price { 
    font-size: 24px; 
    font-weight: 700; 
    color: #fbbf24; 
    margin: 10px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .purchase-price .coins-icon { 
    font-size: 20px; 
    animation: coinSpin 2s ease-in-out infinite; 
  }
  .purchase-actions { 
    display: flex; 
    gap: 15px; 
    justify-content: center; 
    margin-top: 30px; 
  }
  .btn.purchase { background: #fbbf24; color: #1f2937; }
  .btn.purchase:hover { background: #f59e0b; }
  .btn.purchase:disabled { 
    background: #6b7280; 
    color: #9ca3af; 
    cursor: not-allowed; 
  }
  
  .btn.purchase:disabled:hover {
    background: #6b7280;
  }
  
  .add-coins-input-container {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 20px 0;
    padding: 15px;
    background: #1f2937;
    border-radius: 12px;
    border: 2px solid #374151;
  }
  
  .add-coins-input {
    flex: 1;
    padding: 12px 16px;
    background: #374151;
    border: 1px solid #6b7280;
    border-radius: 8px;
    color: #f1f5f9;
    font-size: 16px;
    font-weight: 600;
    text-align: center;
  }
  
  .add-coins-input:focus {
    outline: none;
    border-color: #7c3aed;
    box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.2);
  }
  
  .add-coins-input::placeholder {
    color: #9ca3af;
  }
  
  .add-coins-description {
    color: #9ca3af;
    font-size: 14px;
    margin: 10px 0;
    text-align: center;
  }
  
  .add-coins-error {
    color: #f87171;
    background: #7f1d1d;
    border: 1px solid #f87171;
    padding: 10px 15px;
    border-radius: 8px;
    margin: 15px 0;
    font-size: 14px;
    text-align: center;
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
</style>
<body>
  <nav class="navbar">
    <div class="nav-container">
      <div class="nav-brand">
        <span class="nav-icon">🎭</span>
        <span class="nav-title">Avatar System</span>
      </div>
      <div class="nav-links">
        <a href="/success" class="nav-link">
          <span>🏠</span>
          Главная
        </a>
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
        <div class="header-left">
          <div>
            <h1>Мой аватар</h1>
            <p><b>${displayName || 'Пользователь'}</b> ${login ? `(@${login})` : ''}</p>
          </div>
        </div>
        <div class="coins-counter" id="coinsCounter">
          <span class="coins-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" style="image-rendering: pixelated; image-rendering: -moz-crisp-edges; image-rendering: crisp-edges;">
              <defs>
                <linearGradient id="coinGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
                  <stop offset="50%" style="stop-color:#FFA500;stop-opacity:1" />
                  <stop offset="100%" style="stop-color:#FF8C00;stop-opacity:1" />
                </linearGradient>
              </defs>
              <circle cx="10" cy="10" r="9" fill="url(#coinGradient)" stroke="#B8860B" stroke-width="1"/>
              <circle cx="10" cy="10" r="6" fill="#FFD700" stroke="#DAA520" stroke-width="1"/>
              <circle cx="10" cy="10" r="2" fill="#FFA500"/>
              <rect x="6" y="4" width="2" height="2" fill="#FFFFE0" opacity="0.8"/>
              <rect x="12" y="6" width="1" height="1" fill="#FFFFE0" opacity="0.6"/>
              <rect x="4" y="12" width="1" height="1" fill="#FFFFE0" opacity="0.4"/>
            </svg>
          </span>
          <span id="coinsAmount">0</span>
        </div>
      </div>
    </div>

    <div style="display: flex; gap: 15px; margin-bottom: 30px; flex-wrap: wrap;">
      <a href="/success" class="back-btn">
        <span>←</span>
        Назад к панели
      </a>
      <button class="btn btn-primary" id="customizeBtn">
        <span>🎨</span>
        Настроить внешний вид
      </button>
      ${login === '1_tosik_1' ? '<a href="/admin/skins" class="btn btn-secondary" style="text-decoration: none;"><span>⚙️</span> Управление ценами</a>' : ''}
    </div>

    <div class="main-content">
      <div class="avatar-section">
        <h2>Текущий аватар</h2>
        <div class="avatar" aria-label="Аватар по слоям">
          <img class="layer body"    alt="body"    src="/parts/body/${avatar?.body_skin || 'body_skin_1'}.png">
          <img class="layer face"    alt="face"    src="/parts/face/${avatar?.face_skin || 'face_skin_1'}.png">
          <img class="layer clothes" alt="clothes" src="/parts/clothes/${avatar?.clothes_type || 'clothes_type_1'}.png">
          <img class="layer others"  alt="others"  src="/parts/others/${avatar?.others_type || 'others_1'}.png">
        </div>
      </div>

      <div class="stats-section">
        <div class="section-header">
          <h2>Статистика подарков</h2>
          <p>Ваши достижения и награды от зрителей</p>
        </div>
        
        <div class="stats-grid">
          <div class="stat-card stat-total clickable" onclick="showGiftsModal('all')">
            <div class="stat-icon">🎁</div>
            <div class="stat-info">
              <div class="stat-value">${gifts.length}</div>
              <div class="stat-label">Всего подарков</div>
              <div class="stat-description">уникальных типов</div>
            </div>
          </div>
          <div class="stat-card stat-total-count clickable" onclick="showGiftsModal('total')">
            <div class="stat-icon">📊</div>
            <div class="stat-info">
              <div class="stat-value">${giftStats.reduce((sum, stat) => sum + stat.total_gifts, 0)}</div>
              <div class="stat-label">Всего получено</div>
              <div class="stat-description">включая дубликаты</div>
            </div>
          </div>
          <div class="stat-card stat-common clickable" onclick="showGiftsModal('common')">
            <div class="stat-icon">📦</div>
            <div class="stat-info">
              <div class="stat-value">${giftStats.find(s => s.gift_type === 'common')?.total_gifts || 0}</div>
              <div class="stat-label">Обычные подарки</div>
              <div class="stat-description">подарки</div>
            </div>
          </div>
          <div class="stat-card stat-uncommon clickable" onclick="showGiftsModal('uncommon')">
            <div class="stat-icon">💎</div>
            <div class="stat-info">
              <div class="stat-value">${giftStats.find(s => s.gift_type === 'uncommon')?.total_gifts || 0}</div>
              <div class="stat-label">Необычные подарки</div>
              <div class="stat-description">подарки</div>
            </div>
          </div>
          <div class="stat-card stat-rare clickable" onclick="showGiftsModal('rare')">
            <div class="stat-icon">👑</div>
            <div class="stat-info">
              <div class="stat-value">${giftStats.find(s => s.gift_type === 'rare')?.total_gifts || 0}</div>
              <div class="stat-label">Редкие подарки</div>
              <div class="stat-description">подарки</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Customize Modal -->
    <div id="customizeModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Настройка внешнего вида</h2>
          <span class="close">&times;</span>
        </div>
        <div style="margin-bottom: 15px; padding: 12px; background: #1e40af; border-radius: 8px; color: #dbeafe; font-size: 13px;">
          <strong>💡 Подсказка:</strong> Текущие слои уже выбраны. Кликните на те варианты, которые хотите изменить. Заблокированные скины можно купить за монетки!
        </div>
        <div id="customizeContent">
          <div class="customize-grid" id="customizeGrid">
            <!-- Content will be loaded dynamically -->
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="resetBtn">Сбросить</button>
          <button class="btn secondary" id="cancelBtn">Отмена</button>
          <button class="btn" id="saveBtn">Сохранить</button>
        </div>
      </div>
    </div>

    <!-- Purchase Modal -->
    <div id="purchaseModal" class="modal">
      <div class="modal-content purchase-modal">
        <div class="modal-header">
          <h2>Покупка скина</h2>
          <span class="close" id="purchaseClose">&times;</span>
        </div>
        <div class="purchase-content">
          <div class="purchase-skin-preview" id="purchaseSkinPreview">
            <!-- Skin preview will be loaded here -->
          </div>
          <div class="purchase-info">
            <h3 id="purchaseSkinName">Название скина</h3>
            <div class="purchase-price" id="purchasePrice">
              <span class="coins-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" style="image-rendering: pixelated; image-rendering: -moz-crisp-edges; image-rendering: crisp-edges;">
                  <defs>
                    <linearGradient id="coinGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
                      <stop offset="50%" style="stop-color:#FFA500;stop-opacity:1" />
                      <stop offset="100%" style="stop-color:#FF8C00;stop-opacity:1" />
                    </linearGradient>
                  </defs>
                  <!-- Внешний круг монеты -->
                  <circle cx="10" cy="10" r="9" fill="url(#coinGradient)" stroke="#B8860B" stroke-width="1"/>
                  <!-- Внутренний круг -->
                  <circle cx="10" cy="10" r="6" fill="#FFD700" stroke="#DAA520" stroke-width="1"/>
                  <!-- Центральная точка -->
                  <circle cx="10" cy="10" r="2" fill="#FFA500"/>
                  <!-- Пиксельные блики -->
                  <rect x="6" y="4" width="2" height="2" fill="#FFFFE0" opacity="0.8"/>
                  <rect x="12" y="6" width="1" height="1" fill="#FFFFE0" opacity="0.6"/>
                  <rect x="4" y="12" width="1" height="1" fill="#FFFFE0" opacity="0.4"/>
                </svg>
              </span>
              <span id="purchasePriceAmount">0</span>
            </div>
            <p id="purchaseDescription">Описание скина</p>
          </div>
          <div class="purchase-actions">
            <button class="btn secondary" id="purchaseCancel">Отмена</button>
            <button class="btn purchase" id="purchaseConfirm">Купить</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Coins Modal -->
    <div id="addCoinsModal" class="modal">
      <div class="modal-content purchase-modal">
        <div class="modal-header">
          <h2>Пополнение баланса</h2>
          <span class="close" id="addCoinsClose">&times;</span>
        </div>
        <div class="purchase-content">
          <div class="purchase-info">
            <h3>Введите сумму для пополнения</h3>
            <div class="add-coins-input-container">
              <input type="number" id="addCoinsAmount" placeholder="Введите количество монет" min="1" max="10000" class="add-coins-input">
              <div class="coins-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" style="image-rendering: pixelated; image-rendering: -moz-crisp-edges; image-rendering: crisp-edges;">
                  <defs>
                    <linearGradient id="coinGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
                      <stop offset="50%" style="stop-color:#FFA500;stop-opacity:1" />
                      <stop offset="100%" style="stop-color:#FF8C00;stop-opacity:1" />
                    </linearGradient>
                  </defs>
                  <!-- Внешний круг монеты -->
                  <circle cx="10" cy="10" r="9" fill="url(#coinGradient)" stroke="#B8860B" stroke-width="1"/>
                  <!-- Внутренний круг -->
                  <circle cx="10" cy="10" r="6" fill="#FFD700" stroke="#DAA520" stroke-width="1"/>
                  <!-- Центральная точка -->
                  <circle cx="10" cy="10" r="2" fill="#FFA500"/>
                  <!-- Пиксельные блики -->
                  <rect x="6" y="4" width="2" height="2" fill="#FFFFE0" opacity="0.8"/>
                  <rect x="12" y="6" width="1" height="1" fill="#FFFFE0" opacity="0.6"/>
                  <rect x="4" y="12" width="1" height="1" fill="#FFFFE0" opacity="0.4"/>
                </svg>
              </div>
            </div>
            <p class="add-coins-description">Минимум 1 монета (1 рубль), максимум 10,000 монет<br>Оплата через ЮKassa (1 монета = 1 рубль)</p>
            <div id="addCoinsError" class="add-coins-error" style="display: none;"></div>
          </div>
          <div class="purchase-actions">
            <button class="btn secondary" id="addCoinsCancel">Отмена</button>
            <button class="btn purchase" id="addCoinsConfirm">
              <span id="addCoinsButtonText">Пополнить</span>
              <span id="addCoinsLoading" style="display: none;">⏳ Создание платежа...</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <script>
      const userId = '${uid}';
      let availableParts = {};
      let currentSelections = {};
      let currentCoins = 0;
      let lockedSkins = {};
      let currentPurchaseSkin = null;
      
      
      // Загрузка монет пользователя
      async function loadCoins() {
        try {
          const response = await fetch('/api/user/coins');
          const data = await response.json();
          
          if (data.success) {
            currentCoins = data.data.coins;
            updateCoinsDisplay();
          } else {
            console.error('Error loading coins:', data.error);
          }
        } catch (error) {
          console.error('Error loading coins:', error);
        }
      }

      // Обновление отображения монет
      function updateCoinsDisplay() {
        const coinsElement = document.getElementById('coinsAmount');
        if (coinsElement) {
          coinsElement.textContent = currentCoins.toLocaleString('ru-RU');
          
          // Добавляем анимацию при изменении
          coinsElement.style.transform = 'scale(1.1)';
          setTimeout(() => {
            coinsElement.style.transform = 'scale(1)';
          }, 200);
        }
      }

      // Загрузка заблокированных скинов
      async function loadLockedSkins() {
        try {
          const response = await fetch('/api/skins/locked');
          const data = await response.json();
          
          if (data.success) {
            lockedSkins = {};
            data.data.forEach(skin => {
              const key = \`\${skin.skin_type}_\${skin.skin_id}\`;
              lockedSkins[key] = skin;
            });
          } else {
            console.error('Error loading locked skins:', data.error);
          }
        } catch (error) {
          console.error('Error loading locked skins:', error);
        }
      }

      // Проверка, заблокирован ли скин
      function isSkinLocked(skinType, skinId) {
        const key = \`\${skinType}_\${skinId}\`;
        return lockedSkins[key] && !lockedSkins[key].isPurchased;
      }

      // Получение цены скина
      function getSkinPrice(skinType, skinId) {
        const key = \`\${skinType}_\${skinId}\`;
        return lockedSkins[key] ? lockedSkins[key].price : 0;
      }

      // Показать модальное окно покупки
      function showPurchaseModal(skinType, skinId) {
        const price = getSkinPrice(skinType, skinId);
        if (price === 0) return;

        currentPurchaseSkin = { skinType, skinId, price };
        
        // Находим информацию о скине
        const skinInfo = availableParts[skinType]?.find(part => part.id === skinId);
        if (!skinInfo) return;

        // Обновляем модальное окно
        document.getElementById('purchaseSkinName').textContent = skinInfo.name;
        document.getElementById('purchasePriceAmount').textContent = price.toLocaleString('ru-RU');
        document.getElementById('purchaseDescription').textContent = \`Купить \${skinInfo.name} за \${price} монет?\`;
        
        // Показываем превью скина
        const preview = document.getElementById('purchaseSkinPreview');
        preview.innerHTML = \`<img src="\${skinInfo.path}" alt="\${skinInfo.name}">\`;
        
        // Проверяем, достаточно ли монет
        const purchaseBtn = document.getElementById('purchaseConfirm');
        if (currentCoins < price) {
          purchaseBtn.disabled = true;
          purchaseBtn.textContent = 'Недостаточно монет';
        } else {
          purchaseBtn.disabled = false;
          purchaseBtn.textContent = 'Купить';
        }
        
        // Показываем модальное окно
        document.getElementById('purchaseModal').style.display = 'block';
      }

      // Покупка скина
      async function purchaseSkin() {
        if (!currentPurchaseSkin) return;

        try {
          const response = await fetch('/api/skin/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              skinType: currentPurchaseSkin.skinType,
              skinId: currentPurchaseSkin.skinId
            })
          });

          const data = await response.json();
          
          if (data.success) {
            // Обновляем монеты
            currentCoins = data.data.newCoins;
            updateCoinsDisplay();
            
            // Обновляем статус скина
            const key = \`\${currentPurchaseSkin.skinType}_\${currentPurchaseSkin.skinId}\`;
            if (lockedSkins[key]) {
              lockedSkins[key].isPurchased = true;
            }
            
            // Закрываем модальное окно
            document.getElementById('purchaseModal').style.display = 'none';
            
            // Перезагружаем интерфейс настройки
            renderCustomizeInterface();
            
            alert(data.data.message);
          } else {
            alert('Ошибка при покупке: ' + data.error);
          }
        } catch (error) {
          console.error('Error purchasing skin:', error);
          alert('Ошибка при покупке скина');
        }
      }

      // Load available parts
      async function loadAvailableParts() {
        try {
          const response = await fetch('/api/avatar/parts');
          const data = await response.json();
          if (data.success) {
            availableParts = data.data;
            renderCustomizeInterface();
          }
        } catch (error) {
          console.error('Error loading parts:', error);
        }
      }

      // Render customize interface
      function renderCustomizeInterface() {
        const grid = document.getElementById('customizeGrid');
        grid.innerHTML = '';

        Object.keys(availableParts).forEach(layer => {
          const parts = availableParts[layer];
          if (parts.length === 0) return;

          const section = document.createElement('div');
          section.className = 'layer-section';
          
          const layerName = layer === 'body' ? 'Тело' : 
                           layer === 'face' ? 'Лицо' : 
                           layer === 'clothes' ? 'Одежда' : 'Аксессуары';
          
          section.innerHTML = \`
            <h3>\${layerName}</h3>
            <div class="options-grid" id="\${layer}Options">
              \${parts.map(part => {
                const isLocked = isSkinLocked(layer, part.id);
                const price = isLocked ? getSkinPrice(layer, part.id) : 0;
                
                return \`
                  <div class="option-item \${isLocked ? 'locked' : ''}" data-layer="\${layer}" data-part-id="\${part.id}" data-locked="\${isLocked}">
                    <img src="\${part.path}" alt="\${part.name}">
                    <div class="name">\${part.name}</div>
                    \${isLocked ? \`
                      <div class="lock-overlay">🔒</div>
                      <div class="price">\${price}</div>
                    \` : ''}
                  </div>
                \`;
              }).join('')}
            </div>
          \`;
          
          grid.appendChild(section);
        });

        // Load current avatar data and pre-select current parts
        loadCurrentAvatarData();

        // Add click handlers
        document.querySelectorAll('.option-item').forEach(item => {
          item.addEventListener('click', function() {
            const layer = this.dataset.layer;
            const partId = this.dataset.partId;
            const isLocked = this.dataset.locked === 'true';
            
            if (isLocked) {
              // Показываем модальное окно покупки
              showPurchaseModal(layer, partId);
              return;
            }
            
            // Remove selected class from other items in same layer
            document.querySelectorAll(\`[data-layer="\${layer}"]\`).forEach(el => {
              el.classList.remove('selected');
            });
            
            // Add selected class to clicked item
            this.classList.add('selected');
            
            // Store selection
            currentSelections[layer] = partId;
          });
        });
      }

      // Load current avatar data and pre-select current parts
      async function loadCurrentAvatarData() {
        try {
          const response = await fetch(\`/api/avatar/\${userId}\`);
          const data = await response.json();
          
          if (data.success) {
            const avatar = data.data;
            
            // Pre-select current parts
            if (avatar.body_skin) {
              const bodyItem = document.querySelector(\`[data-layer="body"][data-part-id="\${avatar.body_skin}"]\`);
              if (bodyItem) {
                bodyItem.classList.add('selected');
                currentSelections.body = avatar.body_skin;
              }
            }
            
            if (avatar.face_skin) {
              const faceItem = document.querySelector(\`[data-layer="face"][data-part-id="\${avatar.face_skin}"]\`);
              if (faceItem) {
                faceItem.classList.add('selected');
                currentSelections.face = avatar.face_skin;
              }
            }
            
            if (avatar.clothes_type) {
              const clothesItem = document.querySelector(\`[data-layer="clothes"][data-part-id="\${avatar.clothes_type}"]\`);
              if (clothesItem) {
                clothesItem.classList.add('selected');
                currentSelections.clothes = avatar.clothes_type;
              }
            }
            
            if (avatar.others_type) {
              const othersItem = document.querySelector(\`[data-layer="others"][data-part-id="\${avatar.others_type}"]\`);
              if (othersItem) {
                othersItem.classList.add('selected');
                currentSelections.others = avatar.others_type;
              }
            }
          }
        } catch (error) {
          console.error('Error loading current avatar data:', error);
        }
      }

      // Save changes
      async function saveChanges() {
        const promises = Object.keys(currentSelections).map(layer => {
          const partId = currentSelections[layer];
          return fetch('/api/avatar/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: userId,
              partType: layer,
              partId: partId
            })
          });
        });

        try {
          await Promise.all(promises);
          
          // Clear avatar cache to force reload of new appearance
          await fetch('/api/avatar/clear-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId })
          });

          // Update avatar on stream if user is active
          try {
            await fetch('/api/avatar/update-stream', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: userId,
                streamerId: userId // Use userId as streamerId since user is managing their own avatar
              })
            });
            console.log('Avatar updated on stream');
          } catch (streamError) {
            console.log('User not active on stream or stream not available');
          }
          
          location.reload(); // Reload to show updated avatar
        } catch (error) {
          console.error('Error saving changes:', error);
          alert('Ошибка при сохранении изменений');
        }
      }

      // Reset to current avatar settings
      function resetToCurrent() {
        loadCurrentAvatarData();
      }

      // Modal controls
      const modal = document.getElementById('customizeModal');
      const customizeBtn = document.getElementById('customizeBtn');
      const closeBtn = document.querySelector('.close');
      const resetBtn = document.getElementById('resetBtn');
      const cancelBtn = document.getElementById('cancelBtn');
      const saveBtn = document.getElementById('saveBtn');

      customizeBtn.addEventListener('click', () => {
        modal.style.display = 'block';
        loadAvailableParts();
        loadLockedSkins();
      });

      closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });

      resetBtn.addEventListener('click', resetToCurrent);

      cancelBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });

      saveBtn.addEventListener('click', saveChanges);

      // Purchase modal handlers
      const purchaseModal = document.getElementById('purchaseModal');
      const purchaseClose = document.getElementById('purchaseClose');
      const purchaseCancel = document.getElementById('purchaseCancel');
      const purchaseConfirm = document.getElementById('purchaseConfirm');

      purchaseClose.addEventListener('click', () => {
        purchaseModal.style.display = 'none';
      });

      purchaseCancel.addEventListener('click', () => {
        purchaseModal.style.display = 'none';
      });

      purchaseConfirm.addEventListener('click', purchaseSkin);

      // Close modal when clicking outside
      window.addEventListener('click', (event) => {
        if (event.target === modal) {
          modal.style.display = 'none';
        }
        if (event.target === purchaseModal) {
          purchaseModal.style.display = 'none';
        }
      });

      // Gifts modal functions
      function showGiftsModal(type) {
        const modal = document.getElementById('giftsModal');
        const title = document.getElementById('giftsModalTitle');
        const content = document.getElementById('giftsModalContent');
        
        // Set title based on type
        const titles = {
          'all': 'Все подарки',
          'total': 'Всего получено подарков',
          'unique': 'Уникальные подарки',
          'common': 'Обычные подарки',
          'uncommon': 'Необычные подарки',
          'rare': 'Редкие подарки'
        };
        title.textContent = titles[type] || 'Подарки';
        
        // Filter gifts based on type
        let filteredGifts = ${JSON.stringify(giftsWithNames)};
        const giftStats = ${JSON.stringify(giftStats)};
        const availableGifts = ${JSON.stringify(availableGifts)};
        const giftNames = ${JSON.stringify(giftNames)};
        console.log('Gift names object:', giftNames);
        console.log('Gifts with names:', filteredGifts);
        
        // Define rarity order (higher number = higher priority)
        const rarityOrder = { 'rare': 3, 'uncommon': 2, 'common': 1 };
        
        if (type === 'all') {
          // Show all unique gifts that user actually has
          filteredGifts = filteredGifts.map(gift => {
            const giftType = gift.gift_type;
            const giftId = gift.gift_id.replace(\`gift_\${giftType}_\`, '');
            
            return {
              ...gift,
              gift_path: \`/parts/gift_\${giftType}/gift_\${giftType}_\${giftId}.png\`,
              rarity_order: rarityOrder[giftType] || 0
            };
          });
          
          // Sort by rarity (rare first, then uncommon, then common)
          filteredGifts = filteredGifts.sort((a, b) => b.rarity_order - a.rarity_order);
        } else if (type === 'total') {
          // Show all gifts with their counts using real user gifts
          const allGifts = [];
          giftStats.forEach(stat => {
            const giftType = stat.gift_type;
            const totalCount = stat.total_gifts;
            
            // Find the first gift of this type that user has
            const userGiftOfType = filteredGifts.find(gift => gift.gift_type === giftType);
            if (userGiftOfType) {
              const giftId = userGiftOfType.gift_id.replace(\`gift_\${giftType}_\`, '');
              const giftName = userGiftOfType.name || \`Подарок \${giftType} #\${giftId}\`;
              
              // Create multiple instances of the same gift based on total count
              for (let i = 0; i < totalCount; i++) {
                allGifts.push({
                  gift_type: giftType,
                  gift_id: userGiftOfType.gift_id,
                  gift_path: \`/parts/gift_\${giftType}/gift_\${giftType}_\${giftId}.png\`,
                  count: 1,
                  rarity_order: rarityOrder[giftType] || 0,
                  name: giftName
                });
              }
            }
          });
          
          // Sort by rarity (rare first, then uncommon, then common)
          filteredGifts = allGifts.sort((a, b) => b.rarity_order - a.rarity_order);
        } else if (type === 'unique') {
          // Show unique gifts with correct paths
          filteredGifts = filteredGifts.map(gift => {
            const giftType = gift.gift_type;
            const giftId = gift.gift_id.replace(\`gift_\${giftType}_\`, '');
            
            return {
              ...gift,
              gift_path: \`/parts/gift_\${giftType}/gift_\${giftType}_\${giftId}.png\`,
              rarity_order: rarityOrder[giftType] || 0
            };
          });
          
          // Sort by rarity (rare first, then uncommon, then common)
          filteredGifts = filteredGifts.sort((a, b) => b.rarity_order - a.rarity_order);
        } else {
          // Filter by specific type and add correct paths
          filteredGifts = filteredGifts
            .filter(gift => gift.gift_type === type)
            .map(gift => {
              const giftType = gift.gift_type;
              const giftId = gift.gift_id.replace(\`gift_\${giftType}_\`, '');
              
              return {
                ...gift,
                gift_path: \`/parts/gift_\${giftType}/gift_\${giftType}_\${giftId}.png\`
              };
            });
        }
        
        // Render gifts
        if (filteredGifts.length > 0) {
          content.innerHTML = \`
            <div class="gifts-modal-grid">
              \${filteredGifts.map((gift, index) => \`
                <div class="gift-modal-item" onclick="showGiftDetail('\${gift.gift_type}', '\${gift.gift_id}', '\${gift.gift_path || \`/parts/gift_\${gift.gift_type}/gift_\${gift.gift_type}_\${gift.gift_id}.png\`}', \${gift.count})">
                  <img src="\${gift.gift_path || \`/parts/gift_\${gift.gift_type}/gift_\${gift.gift_type}_\${gift.gift_id}.png\`}" alt="\${gift.gift_type} gift">
                  <div class="gift-name">\${gift.name || \`Подарок \${gift.gift_type} #\${gift.gift_id}\`}</div>
                  <div class="gift-count">Получено: \${gift.count} раз</div>
                  <span class="gift-type \${gift.gift_type}">\${gift.gift_type}</span>
                </div>
              \`).join('')}
            </div>
          \`;
        } else {
          content.innerHTML = \`
            <div class="empty-state">
              <img src="/parts/gift_common/gift_common_1.png" alt="No gifts">
              <p>У вас пока нет подарков этого типа</p>
            </div>
          \`;
        }
        
        modal.style.display = 'block';
      }
      
      function closeGiftsModal() {
        document.getElementById('giftsModal').style.display = 'none';
      }
      
      // Gift detail modal functions
      function showGiftDetail(giftType, giftId, giftPath, giftCount) {
        const modal = document.getElementById('giftDetailModal');
        const title = document.getElementById('giftDetailTitle');
        const image = document.getElementById('giftDetailImage');
        const name = document.getElementById('giftDetailName');
        const count = document.getElementById('giftDetailCount');
        
        // Get gift name from giftNames object
        const giftName = giftNames[giftType] && giftNames[giftType][giftId] 
          ? giftNames[giftType][giftId] 
          : \`Подарок #\${giftId}\`;
        
        // Set gift details
        title.textContent = giftName;
        image.src = giftPath;
        image.alt = \`\${giftName}\`;
        name.textContent = giftName;
        count.textContent = \`\${giftCount} раз\`;
        
        modal.style.display = 'block';
      }
      
      function closeGiftDetailModal() {
        document.getElementById('giftDetailModal').style.display = 'none';
      }
      
      // Close gifts modal when clicking outside
      window.addEventListener('click', (event) => {
        const giftsModal = document.getElementById('giftsModal');
        if (event.target === giftsModal) {
          giftsModal.style.display = 'none';
        }
        
        const giftDetailModal = document.getElementById('giftDetailModal');
        if (event.target === giftDetailModal) {
          giftDetailModal.style.display = 'none';
        }
      });
      
      // Функции для пополнения баланса
      function showAddCoinsModal() {
        document.getElementById('addCoinsModal').style.display = 'block';
        document.getElementById('addCoinsAmount').value = '';
        document.getElementById('addCoinsError').style.display = 'none';
        document.getElementById('addCoinsAmount').focus();
      }

      function hideAddCoinsModal() {
        document.getElementById('addCoinsModal').style.display = 'none';
      }

      function validateAmount(amount) {
        const num = parseInt(amount);
        if (isNaN(num) || num <= 0) {
          return 'Введите корректное количество монет (больше 0)';
        }
        if (num < 100) {
          return 'Минимум 100 монет (1 рубль) за транзакцию';
        }
        if (num > 10000) {
          return 'Максимум 10,000 монет за одну транзакцию';
        }
        if (!Number.isInteger(parseFloat(amount))) {
          return 'Количество монет должно быть целым числом';
        }
        return null;
      }

      function showAddCoinsError(message) {
        const errorEl = document.getElementById('addCoinsError');
        errorEl.textContent = message;
        errorEl.style.display = 'block';
      }

      function hideAddCoinsError() {
        document.getElementById('addCoinsError').style.display = 'none';
      }

      function showAddCoinsLoading() {
        document.getElementById('addCoinsButtonText').style.display = 'none';
        document.getElementById('addCoinsLoading').style.display = 'inline';
        document.getElementById('addCoinsConfirm').disabled = true;
      }

      function hideAddCoinsLoading() {
        document.getElementById('addCoinsButtonText').style.display = 'inline';
        document.getElementById('addCoinsLoading').style.display = 'none';
        document.getElementById('addCoinsConfirm').disabled = false;
      }

      async function addCoins() {
        const amountInput = document.getElementById('addCoinsAmount');
        const amount = amountInput.value.trim();
        
        // Валидация
        const validationError = validateAmount(amount);
        if (validationError) {
          showAddCoinsError(validationError);
          return;
        }

        hideAddCoinsError();
        showAddCoinsLoading();

        try {
          // Создаем платеж через ЮKassa
          const response = await fetch('/api/payment/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: parseInt(amount) })
          });

          const data = await response.json();
          
          if (data.success) {
            // Закрываем модальное окно
            hideAddCoinsModal();
            
            // Перенаправляем на страницу оплаты ЮKassa
            window.location.href = data.data.paymentUrl;
          } else {
            showAddCoinsError(data.error);
            hideAddCoinsLoading();
          }
        } catch (error) {
          console.error('Error creating payment:', error);
          showAddCoinsError('Ошибка при создании платежа');
          hideAddCoinsLoading();
        }
      }

      // Обработчики событий для модального окна пополнения баланса
      const addCoinsModal = document.getElementById('addCoinsModal');
      const addCoinsClose = document.getElementById('addCoinsClose');
      const addCoinsCancel = document.getElementById('addCoinsCancel');
      const addCoinsConfirm = document.getElementById('addCoinsConfirm');
      const addCoinsAmount = document.getElementById('addCoinsAmount');
      const coinsCounter = document.getElementById('coinsCounter');

      // Клик по монетке
      coinsCounter.addEventListener('click', showAddCoinsModal);

      // Закрытие модального окна
      addCoinsClose.addEventListener('click', hideAddCoinsModal);
      addCoinsCancel.addEventListener('click', hideAddCoinsModal);

      // Подтверждение пополнения
      addCoinsConfirm.addEventListener('click', addCoins);

      // Обработка Enter в поле ввода
      addCoinsAmount.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          addCoins();
        }
      });

      // Очистка ошибки при изменении ввода
      addCoinsAmount.addEventListener('input', hideAddCoinsError);

      // Закрытие модального окна при клике вне его
      window.addEventListener('click', (event) => {
        if (event.target === addCoinsModal) {
          hideAddCoinsModal();
        }
      });

      // Загружаем монеты и заблокированные скины при загрузке страницы
      loadCoins();
      loadLockedSkins();
      
    </script>
  </div>

  <!-- Gifts Modal -->
  <div id="giftsModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="giftsModalTitle">Подарки</h2>
        <span class="close" onclick="closeGiftsModal()">&times;</span>
      </div>
      <div class="modal-body">
        <div id="giftsModalContent">
          <!-- Content will be loaded here -->
        </div>
      </div>
    </div>
  </div>

  <!-- Gift Detail Modal -->
  <div id="giftDetailModal" class="modal">
    <div class="modal-content gift-detail-modal">
      <div class="modal-header">
        <h2 id="giftDetailTitle">Подарок</h2>
        <span class="close" onclick="closeGiftDetailModal()">&times;</span>
      </div>
      <div class="modal-body gift-detail-body">
        <div class="gift-detail-content">
          <div class="gift-image-container">
            <img id="giftDetailImage" src="" alt="Gift" class="gift-detail-image">
          </div>
          <div class="gift-detail-info">
            <h3 id="giftDetailName">Название подарка</h3>
            <div class="gift-detail-stats">
              <div class="stat-item">
                <span class="stat-label">Получено:</span>
                <span id="giftDetailCount">1 раз</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
    `);
  });
}

module.exports = { registerMyAvatarRoute };
