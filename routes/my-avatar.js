const db = require('../lib/db/async');
const { getUserByTwitchId, getAvatarByTwitchId, getUserGifts, getUserGiftStats, getAvailableGifts, updateAvatarPart, getUserCoins, addUserCoins, getLockedSkins, getUserPurchasedSkins, isSkinPurchased, purchaseSkin, purchaseSkinsBundle, getSkinPrice, getAllSkinsWithPrices, updateSkinPrice, bulkUpdateSkinPrices, getGiftInfo, refreshSkinsFromFilesystem, getAllUsers, grantSkinToUser, revokeSkinFromUser, grantSkinsToUser, revokeSkinsFromUser } = db;

function registerMyAvatarRoute(app) {

  // API для получения монет пользователя
  app.get('/api/user/coins', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const coins = await getUserCoins(uid);
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
    const uid = req.cookies.uid;
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
  app.post('/api/payment/success', async (req, res) => {
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
      const newCoins = await addUserCoins(userId, amount);
      
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
  app.post('/api/user/add-coins', async (req, res) => {
    const uid = req.cookies.uid;
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
      const newCoins = await addUserCoins(uid, amount);
      
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
  app.post('/api/skin/purchase', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { skinType, skinId } = req.body;
    if (!skinType || !skinId) {
      return res.status(400).json({ error: 'Missing skinType or skinId' });
    }

    try {
      const price = await getSkinPrice(skinType, skinId);
      if (price === 0) {
        return res.status(400).json({ error: 'Skin not found or not locked' });
      }

      const result = await purchaseSkin(uid, skinType, skinId, price);
      
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

  // API для пакетной покупки частей скина
  app.post('/api/skin/purchase-bundle', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { items } = req.body; // [{ skinType, skinId }]
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items must be a non-empty array' });
    }

    try {
      const result = await purchaseSkinsBundle(uid, items);
      if (result.success) {
        res.json({ success: true, data: { newCoins: result.newCoins, purchasedCount: result.purchasedCount, totalPrice: result.totalPrice } });
      } else {
        res.status(400).json({ error: result.error || 'Failed to purchase bundle' });
      }
    } catch (error) {
      console.error('Error purchasing bundle:', error);
      res.status(500).json({ error: 'Failed to purchase bundle' });
    }
  });

  // API для получения информации о подарках
  app.get('/api/gifts/info', async (req, res) => {
    try {
      const { giftType, giftId } = req.query;
      
      if (!giftType || !giftId) {
        return res.status(400).json({ error: 'Missing giftType or giftId' });
      }

      const giftInfo = await getGiftInfo(giftType, giftId);
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
  app.get('/api/skins/locked', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const lockedSkins = await getLockedSkins();
      const purchasedSkins = await getUserPurchasedSkins(uid);
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
  app.get('/api/admin/skins', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const allSkins = await getAllSkinsWithPrices();
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
  app.post('/api/admin/skin/price', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { skinType, skinId, price, isLocked } = req.body;
    if (!skinType || !skinId || price === undefined) {
      return res.status(400).json({ error: 'Missing skinType, skinId or price' });
    }

    try {
      const result = await updateSkinPrice(skinType, skinId, price, isLocked);
      
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

  // API: список пользователей (админ)
  app.get('/api/admin/users', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const user = await getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') return res.status(403).json({ error: 'Access denied' });
    const usersRaw = await getAllUsers();
    const users = usersRaw.map(u => ({
      twitch_user_id: u.twitch_user_id,
      display_name: u.display_name || u.login || u.twitch_user_id,
      login: u.login || '',
      coins: u.coins || 0
    }));
    res.json({ success: true, data: users });
  });

  // API: получить список скинов пользователя с пометкой куплено (админ)
  app.get('/api/admin/user/:userId/skins', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const user = await getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') return res.status(403).json({ error: 'Access denied' });

    const targetUserId = req.params.userId;
    try {
      const allSkins = await getAllSkinsWithPrices();
      const purchased = await getUserPurchasedSkins(targetUserId);
      const purchasedSet = new Set(purchased.map(s => `${s.skin_type}_${s.skin_id}`));
      const result = allSkins.map(s => ({
        ...s,
        isPurchased: purchasedSet.has(`${s.skinType}_${s.skinId}`)
      }));
      res.json({ success: true, data: result });
    } catch (e) {
      console.error('Error getting user skins:', e);
      res.status(500).json({ error: 'Failed to get user skins' });
    }
  });

  // API: выставить доступ к скину (админ)
  app.post('/api/admin/user/:userId/skins/set', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const user = await getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') return res.status(403).json({ error: 'Access denied' });

    const targetUserId = req.params.userId;
    const { skinType, skinId, purchased } = req.body;
    if (!skinType || !skinId || typeof purchased !== 'boolean') {
      return res.status(400).json({ error: 'Missing skinType, skinId or purchased' });
    }
    try {
      const result = purchased
        ? await grantSkinToUser(targetUserId, skinType, skinId)
        : await revokeSkinFromUser(targetUserId, skinType, skinId);
      if (result.success) return res.json({ success: true });
      return res.status(400).json({ error: result.error || 'Failed to update' });
    } catch (e) {
      console.error('Error setting user skin:', e);
      res.status(500).json({ error: 'Failed to set user skin' });
    }
  });

  // API: массово выдать/отозвать полный скин (все части по номеру)
  app.post('/api/admin/user/:userId/skins/bundle-set', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const user = await getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') return res.status(403).json({ error: 'Access denied' });

    const targetUserId = req.params.userId;
    const { number, purchased } = req.body; // number: numeric suffix, purchased: boolean
    const n = String(number || '').trim();
    if (!n || (purchased !== true && purchased !== false)) {
      return res.status(400).json({ error: 'Missing number or purchased' });
    }

    const parts = [
      { skinType: 'body', skinId: 'body_skin_' + n },
      { skinType: 'face', skinId: 'face_skin_' + n },
      { skinType: 'clothes', skinId: 'clothes_type_' + n },
      { skinType: 'others', skinId: 'others_' + n }
    ];

    try {
      let updated = 0;
      for (const part of parts) {
        const result = purchased
          ? await grantSkinToUser(targetUserId, part.skinType, part.skinId)
          : await revokeSkinFromUser(targetUserId, part.skinType, part.skinId);
        if (result && result.success) {
          updated++;
        }
      }
      return res.json({ success: true, updated });
    } catch (e) {
      console.error('Error setting bundle skins:', e);
      return res.status(500).json({ error: 'Failed to set bundle' });
    }
  });

  // API: пакетная выдача/отзыв набора частей (целый скин по номеру)
  app.post('/api/admin/user/:userId/skins/set-bundle', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const user = await getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') return res.status(403).json({ error: 'Access denied' });

    const targetUserId = req.params.userId;
    const { items, purchased } = req.body; // items: [{ skinType, skinId }]
    if (!Array.isArray(items) || typeof purchased !== 'boolean') {
      return res.status(400).json({ error: 'Missing items or purchased' });
    }
    try {
      const result = purchased ? await grantSkinsToUser(targetUserId, items) : await revokeSkinsFromUser(targetUserId, items);
      if (result.success) return res.json({ success: true, count: result.count });
      return res.status(400).json({ error: result.error || 'Failed to update bundle' });
    } catch (e) {
      console.error('Error setting user skin bundle:', e);
      res.status(500).json({ error: 'Failed to set user skin bundle' });
    }
  });

  // API для массового обновления цен
  app.post('/api/admin/skins/bulk-update', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { skins } = req.body;
    if (!Array.isArray(skins)) {
      return res.status(400).json({ error: 'Skins must be an array' });
    }

    try {
      const results = await bulkUpdateSkinPrices(skins);
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

  // API для обновления скинов из файловой системы
  app.post('/api/admin/skins/refresh', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getUserByTwitchId(uid);
    if (!user || user.login !== '1_tosik_1') {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const result = await refreshSkinsFromFilesystem();
      
      res.json({
        success: result.success,
        message: result.success ? 
          `Обновлено скинов из файловой системы: добавлено ${result.addedCount} новых скинов` : 
          'Ошибка при обновлении скинов',
        data: result
      });
    } catch (error) {
      console.error('Error refreshing skins:', error);
      res.status(500).json({ error: 'Failed to refresh skins' });
    }
  });

  // Админ-страница для управления ценами скинов
  app.get('/admin/skins', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.redirect('/');
    }

    const user = await getUserByTwitchId(uid);
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
        <button class="btn" onclick="refreshSkinsFromFilesystem()">📁 Обновить из файлов</button>
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

    // Обновление скинов из файловой системы
    async function refreshSkinsFromFilesystem() {
      try {
        const response = await fetch('/api/admin/skins/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        
        if (data.success) {
          showMessage(data.message, 'success');
          // Перезагружаем скины после обновления
          await loadSkins();
        } else {
          showMessage('Ошибка обновления скинов: ' + data.error, 'error');
        }
      } catch (error) {
        console.error('Error refreshing skins:', error);
        showMessage('Ошибка обновления скинов', 'error');
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

  // Админ-страница: доступ к скинам пользователей
  app.get('/admin/users', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.redirect('/');
    }

    const user = await getUserByTwitchId(uid);
    if (!user) {
      return res.redirect('/');
    }

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
}</style>
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
<title>Доступ к скинам пользователей</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; }
  .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
  .back-btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; height: 40px; padding: 0 16px; background: #7c3aed; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 14px; }
  .back-btn:hover { background: #6d28d9; }
  .layout { display: grid; grid-template-columns: 360px 1fr; gap: 20px; }
  .card { background: #111827; padding: 16px; border-radius: 12px; border: 1px solid #374151; }
  .search { width: 100%; padding: 10px 12px; background: #374151; border: 1px solid #6b7280; border-radius: 8px; color: #f1f5f9; }
  .user-list { max-height: 70vh; overflow-y: auto; margin-top: 12px; display: grid; gap: 8px; }
  .user-item { padding: 10px; border: 1px solid #374151; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
  .user-item:hover { background: #1f2937; }
  .user-item.active { border-color: #7c3aed; background: #1f2937; }
  .skins-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .skin-card { background: #1f2937; padding: 12px; border-radius: 10px; border: 1px solid #374151; }
  .skin-preview { width: 72px; height: 72px; background: #111827; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
  .skin-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .skin-name { font-weight: 700; font-size: 14px; }
  .skin-meta { color: #9ca3af; font-size: 12px; margin: 4px 0 8px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; }
  .btn.grant { background: #10b981; color: white; }
  .btn.revoke { background: #ef4444; color: white; }
  .btn.neutral { background: #374151; color: #e2e8f0; }
  .status { margin-top: 10px; font-size: 12px; color: #9ca3af; }
</style>
<body>
  <div class="container">
    <a href="/my-avatar" class="back-btn">← Назад</a>
    <div class="header">
      <h1>Доступ к скинам пользователей</h1>
      <div><b>${displayName}</b> ${login ? `(@${login})` : ''}</div>
    </div>

    <div class="layout">
      <div class="card">
        <input id="userSearch" class="search" placeholder="Поиск пользователя по имени или логину" />
        <div id="usersContainer" class="user-list">Загрузка пользователей...</div>
      </div>
      <div class="card">
        <div id="selectedUserTitle" style="margin-bottom:10px; font-weight:700;">Выберите пользователя слева</div>
        <div id="skinsContainer"></div>
        <div id="statusMsg" class="status"></div>
      </div>
    </div>
  </div>

  <script>
    let allUsers = [];
    let filteredUsers = [];
    let selectedUserId = null;
    let currentSkins = [];

    async function loadUsers() {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.success) {
        allUsers = data.data;
        filteredUsers = allUsers;
        renderUsers();
      } else {
        document.getElementById('usersContainer').textContent = 'Не удалось загрузить пользователей';
      }
    }

    function renderUsers() {
      const container = document.getElementById('usersContainer');
      if (!filteredUsers.length) { container.textContent = 'Ничего не найдено'; return; }
      container.innerHTML = filteredUsers.map(function(u) {
        return (
          '<div class="user-item ' + (u.twitch_user_id === selectedUserId ? 'active' : '') + '" data-id="' + u.twitch_user_id + '">' +
            '<div>' +
              '<div style="font-weight:700;">' + (u.display_name || '') + '</div>' +
              '<div style="color:#9ca3af; font-size:12px;">@' + (u.login || '') + '</div>' +
            '</div>' +
            '<div style="color:#fbbf24; font-weight:700;">' + ((u.coins||0).toLocaleString('ru-RU')) + ' 💰</div>' +
          '</div>'
        );
      }).join('');
      document.querySelectorAll('.user-item').forEach(el => {
        el.addEventListener('click', () => {
          selectedUserId = el.getAttribute('data-id');
          document.getElementById('selectedUserTitle').textContent = 'Пользователь: ' + (filteredUsers.find(u => u.twitch_user_id === selectedUserId)?.display_name || selectedUserId);
          renderUsers();
          loadUserSkins();
        });
      });
    }

    document.getElementById('userSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      filteredUsers = allUsers.filter(u =>
        (u.display_name || '').toLowerCase().includes(q) ||
        (u.login || '').toLowerCase().includes(q)
      );
      renderUsers();
    });

    async function loadUserSkins() {
      if (!selectedUserId) return;
      document.getElementById('skinsContainer').innerHTML = '<div class="loading">Загрузка скинов...</div>';
      const res = await fetch('/api/admin/user/' + selectedUserId + '/skins');
      const data = await res.json();
      if (data.success) {
        currentSkins = data.data;
        renderSkins();
      } else {
        document.getElementById('skinsContainer').textContent = 'Не удалось загрузить скины пользователя';
      }
    }

    function extractNumber(skinType, skinId) {
      // Ожидаемые форматы: body_skin_N, face_skin_N, clothes_type_N, others_N
      var match = (skinId || '').match(/(\d+)$/);
      return match ? match[1] : null;
    }

    async function setBundle(number, purchased) {
      if (!selectedUserId) return;
      setStatus('Сохранение набора...');
      const res = await fetch('/api/admin/user/' + selectedUserId + '/skins/bundle-set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: number, purchased: !!purchased })
      });
      const data = await res.json();
      if (data.success) {
        // Обновляем локально статусы всех частей набора
        var types = ['body','face','clothes','others'];
        types.forEach(function(t){
          var id = (t === 'body' ? 'body_skin_' : t === 'face' ? 'face_skin_' : t === 'clothes' ? 'clothes_type_' : 'others_') + number;
          var item = currentSkins.find(function(s){ return s.skinType === t && s.skinId === id; });
          if (item) item.isPurchased = !!purchased;
        });
        renderBundles();
        renderSkins();
        setStatus('Сохранено');
      } else {
        setStatus('Ошибка: ' + (data.error || ''));
      }
    }

    function renderBundles() {
      var container = document.getElementById('bundlesContainer');
      if (!container) return;
      // Группируем доступные номера по типам (others необязателен для показа набора)
      var byType = { body: new Set(), face: new Set(), clothes: new Set(), others: new Set() };
      currentSkins.forEach(function(s){
        var n = extractNumber(s.skinType, s.skinId);
        if (!n) return;
        if (byType[s.skinType]) byType[s.skinType].add(n);
      });
      // Пересечение по базовым типам (body, face, clothes)
      var numbers = Array.from(byType.body).filter(function(n){ return byType.face.has(n) && byType.clothes.has(n); });
      numbers.sort(function(a,b){ return parseInt(a) - parseInt(b); });
      if (numbers.length === 0) { container.innerHTML = '<div style="color:#9ca3af;">Нет доступных наборов</div>'; return; }

      container.innerHTML = numbers.map(function(n){
        // Получаем элементы набора
        var parts = {
          body: currentSkins.find(function(s){ return s.skinType==='body' && extractNumber('body', s.skinId)===n; }),
          face: currentSkins.find(function(s){ return s.skinType==='face' && extractNumber('face', s.skinId)===n; }),
          clothes: currentSkins.find(function(s){ return s.skinType==='clothes' && extractNumber('clothes', s.skinId)===n; }),
          others: currentSkins.find(function(s){ return s.skinType==='others' && extractNumber('others', s.skinId)===n; })
        };
        var isAllPurchased = (
          parts.body && parts.face && parts.clothes &&
          parts.body.isPurchased && parts.face.isPurchased && parts.clothes.isPurchased &&
          (parts.others ? parts.others.isPurchased : true)
        );
        var preview = (
          '<div class="avatar preset-preview" style="width: 120px; height: 120px; margin-bottom:6px;">' +
            '<img class="layer body"    alt="body"    src="' + (parts.body ? parts.body.path : '') + '">' +
            '<img class="layer face"    alt="face"    src="' + (parts.face ? parts.face.path : '') + '">' +
            '<img class="layer clothes" alt="clothes" src="' + (parts.clothes ? parts.clothes.path : '') + '">' +
            '<img class="layer others"  alt="others"  src="' + (parts.others ? parts.others.path : '') + '">' +
          '</div>'
        );
        return (
          '<div class="skin-card" data-bundle="' + n + '">' +
            preview +
            '<div class="skin-name">Скин #' + n + '</div>' +
            '<div class="skin-meta">' + (isAllPurchased ? 'Выдан' : 'Не выдан') + '</div>' +
            '<button class="btn ' + (isAllPurchased ? 'revoke' : 'grant') + '" data-number="' + n + '" data-all="' + (isAllPurchased ? '1' : '0') + '">' + (isAllPurchased ? 'Отозвать все' : 'Выдать все') + '</button>' +
          '</div>'
        );
      }).join('');

      container.querySelectorAll('.btn').forEach(function(btn){
        btn.addEventListener('click', function(){
          var number = btn.getAttribute('data-number');
          var isAll = btn.getAttribute('data-all') === '1';
          setBundle(number, !isAll);
        });
      });
    }

    function renderSkins() {
      var container = document.getElementById('skinsContainer');
      if (!currentSkins.length) { container.textContent = 'Скины не найдены'; return; }

      var typesOrder = ['body', 'face', 'clothes', 'others'];
      var typeTitles = { body: 'Тело', face: 'Лицо', clothes: 'Одежда', others: 'Аксессуары' };
      var grouped = { body: [], face: [], clothes: [], others: [] };
      currentSkins.forEach(function(s){ if (grouped[s.skinType]) grouped[s.skinType].push(s); });

      var html = '';
      typesOrder.forEach(function(t){
        if (!grouped[t] || grouped[t].length === 0) return;
        html += '<div class="layer-section">';
        html +=   '<h3 style="margin:0 0 10px; color:#fbbf24;">' + (typeTitles[t] || t) + '</h3>';
        html +=   '<div class="skins-grid">';
        grouped[t].forEach(function(s){
          html +=   '<div class="skin-card" data-id="' + s.skinType + '_' + s.skinId + '">';
          html +=     '<div class="skin-preview"><img src="' + s.path + '" alt="' + s.name + '"></div>';
          html +=     '<div class="skin-name">' + s.name + '</div>';
          html +=     '<div class="skin-meta">' + s.skinType + ' • ' + s.skinId + (s.price ? (' • ' + s.price + ' монет') : '') + '</div>';
          html +=     '<button class="btn ' + (s.isPurchased ? 'revoke' : 'grant') + '" data-type="' + s.skinType + '" data-sid="' + s.skinId + '" data-purchased="' + (s.isPurchased ? '1' : '0') + '">'
                    + (s.isPurchased ? 'Отозвать' : 'Выдать') + '</button>';
          html +=   '</div>';
        });
        html +=   '</div>';
        html += '</div>';
      });

      container.innerHTML = html;
      Array.prototype.forEach.call(container.querySelectorAll('.btn'), function(btn){
        btn.addEventListener('click', function(){ setUserSkin(btn); });
      });
    }

    async function setUserSkin(btn) {
      if (!selectedUserId) return;
      const skinType = btn.getAttribute('data-type');
      const skinId = btn.getAttribute('data-sid');
      const purchased = btn.getAttribute('data-purchased') !== '1';
      setStatus('Сохранение...');
      const res = await fetch('/api/admin/user/' + selectedUserId + '/skins/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skinType, skinId, purchased })
      });
      const data = await res.json();
      if (data.success) {
        // обновляем локально
        const item = currentSkins.find(s => s.skinType === skinType && s.skinId === skinId);
        if (item) item.isPurchased = purchased;
        renderSkins();
        setStatus('Сохранено');
      } else {
        setStatus('Ошибка: ' + (data.error || '')); 
      }
    }

    function setStatus(msg) { document.getElementById('statusMsg').textContent = msg; setTimeout(() => { document.getElementById('statusMsg').textContent = ''; }, 3000); }

    loadUsers();
  </script>
</body>
</html>
    `);
  });

  app.get('/my-avatar', async (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) {
      return res.redirect('/');
    }

    const user = await getUserByTwitchId(uid);
    if (!user) {
      return res.redirect('/');
    }

    const avatar = await getAvatarByTwitchId(uid);
    const gifts = await getUserGifts(uid);
    const giftStats = await getUserGiftStats(uid);
    const availableGifts = await getAvailableGifts();
    
    console.log('Server: Raw gifts data:', gifts);

    // Добавляем названия подарков к данным
    const giftsWithNames = await Promise.all(gifts.map(async (gift) => {
      // Извлекаем номер подарка из полного ID
      const giftId = gift.gift_id.replace(`gift_${gift.gift_type}_`, '');
      const giftInfo = await getGiftInfo(gift.gift_type, giftId);
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
    }));
    
    console.log('Server: Gifts with names:', giftsWithNames);
    
    // Проверяем содержимое таблицы gifts
    console.log('Server: All gifts from DB:', availableGifts);

    // Создаем объект с названиями всех подарков для клиентского кода
    const giftNames = {};
    const giftTypes = ['common', 'uncommon', 'rare'];
    for (const giftType of giftTypes) {
      giftNames[giftType] = {};
      for (let i = 1; i <= 10; i++) { // Предполагаем максимум 10 подарков каждого типа
        const giftInfo = await getGiftInfo(giftType, i.toString());
        giftNames[giftType][i.toString()] = giftInfo?.name || '';
      }
    }

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
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); 
    gap: 12px; 
    margin-bottom: 15px; 
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
    padding: 12px; 
    border-radius: 12px; 
    text-align: left;
    border: 1px solid var(--border);
    transition: all 0.3s ease;
    position: relative;
    overflow: visible;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    min-width: 0;
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
    min-width: 0;
    overflow-wrap: break-word;
    word-wrap: break-word;
  }
  
  .stat-value { 
    font-size: 32px; 
    font-weight: 700; 
    color: var(--text-primary);
    margin-bottom: 4px;
    line-height: 1.1;
  }
  
  .stat-label { 
    font-size: 16px; 
    color: var(--text-primary);
    font-weight: 600;
    margin-bottom: 0;
    line-height: 1.3;
    word-wrap: break-word;
  }
  
  .stat-description { 
    font-size: 14px; 
    color: var(--text-secondary);
    font-weight: 500;
  }
  
  .stat-total .stat-icon {
    background: linear-gradient(135deg, #10b981, #059669);
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
  /* Специфичная раскладка для окна настройки внешнего вида: высота экрана и прокрутка контента */
  #customizeModal .modal-content { 
    width: 96%; 
    max-width: 1100px; 
    margin: 2vh auto; 
    height: 96vh; 
    max-height: 96vh; 
    overflow: hidden; 
    display: flex; 
    flex-direction: column; 
  }
  #customizeContent { 
    flex: 1; 
    min-height: 0; 
    overflow-y: auto; 
  }
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
  
  .customize-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; align-content: start; }
  .layer-section { background: #1f2937; padding: 15px; border-radius: 12px; }
  .layer-section h3 { margin: 0 0 12px; font-size: 16px; color: #fbbf24; }
  .options-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 10px; }
  .option-item { text-align: center; cursor: pointer; padding: 8px; border-radius: 8px; transition: all 0.2s; border: 2px solid transparent; position: relative; }
  .option-item:hover { background-color: #374151; border-color: #6b7280; }
  .option-item.selected { background-color: #7c3aed; border-color: #a855f7; box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.3); }
  .option-item img { width: 48px; height: 48px; object-fit: contain; margin-bottom: 6px; }
  .option-item .name { font-size: 11px; font-weight: 600; }
  .option-item.selected .name { color: white; font-weight: 700; }

  /* Скины в окне настройки: компактные превью и горизонтальная прокрутка */
  .presets-carousel { 
    display: grid; 
    grid-template-columns: 40px 1fr 40px; 
    align-items: center; 
    gap: 10px; 
  }
  .presets-track { 
    display: grid; 
    grid-auto-flow: column; 
    grid-auto-columns: minmax(180px, 1fr); 
    gap: 12px; 
    overflow-x: auto; 
    padding-bottom: 6px; 
  }
  .carousel-btn { 
    height: 36px; 
    width: 36px; 
    border-radius: 8px; 
    border: 1px solid #374151; 
    background: #1f2937; 
    color: #e2e8f0; 
    cursor: pointer; 
  }
  .carousel-btn:hover { background: #374151; }
  .preset-card { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .avatar.preset-preview { width: 140px; height: 140px; }
  
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

  /* Визуал блокировки скина */
  .preset-card.locked .avatar.preset-preview { filter: blur(2px) brightness(0.6); }
  .preset-card.locked .name { color: #9ca3af; }
  .preset-lock-info { 
    position: absolute; 
    top: 8px; 
    right: 8px; 
    background: rgba(15,23,42,0.85); 
    color: #fbbf24; 
    border: 1px solid #f59e0b; 
    border-radius: 8px; 
    padding: 4px 8px; 
    font-size: 12px; 
    font-weight: 700; 
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
      ${login === '1_tosik_1' ? '<a href="/admin/users" class="btn btn-secondary" style="text-decoration: none;"><span>🧑‍💼</span> Доступ к скинам</a>' : ''}
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
              <div class="stat-value">${giftStats.reduce((sum, stat) => sum + stat.total_gifts, 0)}</div>
              <div class="stat-label">Всего подарков</div>
            </div>
          </div>
          <div class="stat-card stat-unique clickable" onclick="showGiftsModal('unique')">
            <div class="stat-icon">✨</div>
            <div class="stat-info">
              <div class="stat-value">${gifts.length}</div>
              <div class="stat-label">Уникальных подарков</div>
            </div>
          </div>
          <div class="stat-card stat-common clickable" onclick="showGiftsModal('common')">
            <div class="stat-icon">📦</div>
            <div class="stat-info">
              <div class="stat-value">${giftStats.find(s => s.gift_type === 'common')?.total_gifts || 0}</div>
              <div class="stat-label">Обычные подарки</div>
            </div>
          </div>
          <div class="stat-card stat-uncommon clickable" onclick="showGiftsModal('uncommon')">
            <div class="stat-icon">💎</div>
            <div class="stat-info">
              <div class="stat-value">${giftStats.find(s => s.gift_type === 'uncommon')?.total_gifts || 0}</div>
              <div class="stat-label">Необычные подарки</div>
            </div>
          </div>
          <div class="stat-card stat-rare clickable" onclick="showGiftsModal('rare')">
            <div class="stat-icon">👑</div>
            <div class="stat-info">
              <div class="stat-value">${giftStats.find(s => s.gift_type === 'rare')?.total_gifts || 0}</div>
              <div class="stat-label">Редкие подарки</div>
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
          <button class="btn secondary" id="backBtn">Назад</button>
          <button class="btn primary" id="saveChangesBtn" style="display: none;">💾 Сохранить изменения</button>
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

    <!-- Purchase Preset Modal -->
    <div id="purchasePresetModal" class="modal">
      <div class="modal-content purchase-modal">
        <div class="modal-header">
          <h2>Покупка скина</h2>
          <span class="close" id="purchasePresetClose">&times;</span>
        </div>
        <div class="purchase-content">
          <div class="purchase-skin-preview" style="width: 180px; height: 180px;" id="purchasePresetPreview"></div>
          <div class="purchase-info">
            <h3 id="purchasePresetName">Полный скин</h3>
            <div class="purchase-price" id="purchasePresetPrice">
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
              <span id="purchasePresetPriceAmount">0</span>
            </div>
            <p id="purchasePresetDescription">Списать монеты за недостающие части скина?</p>
          </div>
          <div class="purchase-actions">
            <button class="btn secondary" id="purchasePresetCancel">Отмена</button>
            <button class="btn purchase" id="purchasePresetConfirm">Купить скин</button>
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
      let selectedPreset = null; // { key?, body, face, clothes, others }
      let currentCoins = 0;
      let lockedSkins = {};
      let currentPurchaseSkin = null;
      let presetDefinitions = [];
      
      
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

      // Покупка скина (пакет недостающих частей)
      let currentPresetPurchase = null; // { preset: string, items: [{skinType, skinId}], totalPrice }

      function showPurchasePresetModal(presetKey, missingItems, totalPrice) {
        const preset = findPresetByKey(presetKey);
        if (!preset) return;

        currentPresetPurchase = { preset: presetKey, items: missingItems, totalPrice };

        // Превью скина
        const preview = document.getElementById('purchasePresetPreview');
        const previewLayers = ['body', 'face', 'clothes', 'others']
          .map(layer => {
            const part = preset.parts[layer];
            return part ? '<img class="layer ' + layer + '" alt="' + layer + '" src="' + part.path + '">' : '';
          })
          .join('');
        preview.innerHTML = ''
          + '<div class="avatar preset-preview" style="width: 160px; height: 160px;">'
          +   previewLayers
          + '</div>';

        const presetTitle = formatPresetTitle(presetKey, preset);
        document.getElementById('purchasePresetName').textContent = 'Полный скин «' + presetTitle + '»';
        document.getElementById('purchasePresetPriceAmount').textContent = totalPrice.toLocaleString('ru-RU');
        const confirmBtn = document.getElementById('purchasePresetConfirm');
        if (currentCoins < totalPrice) {
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Недостаточно монет';
        } else {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Купить скин';
        }

        document.getElementById('purchasePresetModal').style.display = 'block';
      }

      async function purchasePreset() {
        if (!currentPresetPurchase) return;
        try {
          const response = await fetch('/api/skin/purchase-bundle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: currentPresetPurchase.items })
          });

          const data = await response.json();
          if (data.success) {
            currentCoins = data.data.newCoins;
            updateCoinsDisplay();

            // помечаем купленные как purchased
            currentPresetPurchase.items.forEach(i => {
              const key = i.skinType + '_' + i.skinId;
              if (lockedSkins[key]) lockedSkins[key].isPurchased = true;
            });

            document.getElementById('purchasePresetModal').style.display = 'none';

            // применяем скин
            applyPreset(currentPresetPurchase.preset);
          } else {
            alert('Ошибка при покупке скина: ' + (data.error || ''));
          }
        } catch (e) {
          console.error('Error purchasing preset bundle:', e);
          alert('Ошибка при покупке скина');
        }
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

      function derivePresetKey(partId) {
        if (!partId) return null;
        const numericMatch = partId.match(/(\d+)$/);
        if (numericMatch) {
          return numericMatch[1];
        }
        const parts = partId.split('_');
        return parts.length ? parts[parts.length - 1] : partId;
      }

      function formatPresetTitle(key, preset) {
        const titlesMap = { '1': 'Боб', '2': 'Вампир', '3': 'Вояка', '4': 'Врач' };
        if (titlesMap[key]) {
          return titlesMap[key];
        }

        if (/^\d+$/.test(key)) {
          return 'Скин #' + key;
        }

        const sourceName = preset?.parts?.others?.name || preset?.parts?.clothes?.name || preset?.parts?.body?.name || preset?.parts?.face?.name || key;
        return (sourceName || key)
          .toString()
          .replace(/[_-]+/g, ' ')
          .split(' ')
          .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : '')
          .join(' ')
          .trim();
      }

      function findPresetByKey(key) {
        return presetDefinitions.find(preset => preset.key === key);
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

      // Экран скинов перед детальной настройкой
      function renderPresetInterface() {
        const grid = document.getElementById('customizeGrid');
        grid.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'layer-section';

        const layers = ['body', 'face', 'clothes', 'others'];
        const layerMaps = {};
        layers.forEach(layer => {
          layerMaps[layer] = new Map();
          (availableParts?.[layer] || []).forEach(part => {
            const key = derivePresetKey(part.id);
            if (!key) return;
            if (!layerMaps[layer].has(key)) {
              layerMaps[layer].set(key, part);
            }
          });
        });

        const requiredLayers = ['body', 'face', 'clothes'];
        let intersection = null;
        requiredLayers.forEach(layer => {
          const map = layerMaps[layer];
          if (!map) return;
          const currentKeys = Array.from(map.keys());
          if (intersection === null) {
            intersection = new Set(currentKeys);
          } else {
            intersection = new Set([...intersection].filter(key => map.has(key)));
          }
        });

        const sortKeys = keys => keys.sort((a, b) => {
          const aNum = Number(a);
          const bNum = Number(b);
          const aIsNum = !Number.isNaN(aNum);
          const bIsNum = !Number.isNaN(bNum);
          if (aIsNum && bIsNum) return aNum - bNum;
          if (aIsNum) return -1;
          if (bIsNum) return 1;
          return a.localeCompare(b, 'ru', { sensitivity: 'base', numeric: true });
        });

        presetDefinitions = [];
        if (intersection && intersection.size) {
          const sortedKeys = sortKeys(Array.from(intersection));
          presetDefinitions = sortedKeys.map(key => {
            const presetParts = {};
            layers.forEach(layer => {
              const part = layerMaps[layer]?.get(key);
              if (part) {
                presetParts[layer] = part;
              }
            });
            return { key: key.toString(), parts: presetParts };
          });
        }

        if (!presetDefinitions.length) {
          section.innerHTML = \`
            <h3>Выберите скин</h3>
            <p style="margin-top:12px;">Готовые скины пока недоступны. Перейдите к детальной настройке, чтобы собрать образ вручную.</p>
            <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
              <button class="btn secondary" id="toDetailedBtn">Перейти к детальной настройке</button>
            </div>
          \`;

          grid.appendChild(section);

          const toDetailedBtn = document.getElementById('toDetailedBtn');
          if (toDetailedBtn) {
            toDetailedBtn.addEventListener('click', () => {
              loadAvailableParts();
              currentCustomizeView = 'detailed';
            });
          }
          return;
        }

        section.innerHTML = \`
          <h3>Выберите скин</h3>
          <div class="presets-carousel">
            <button class="carousel-btn" id="presetsPrev">‹</button>
            <div class="presets-track" id="presetsGrid">
              \${presetDefinitions.map(preset => {
                const bodyPart = preset.parts.body;
                const facePart = preset.parts.face;
                const clothesPart = preset.parts.clothes;
                const othersPart = preset.parts.others;
                const name = formatPresetTitle(preset.key, preset);
                return \`
                <div class="option-item preset-card" data-preset-key="\${preset.key}">
                  <div class="avatar preset-preview" aria-label="Скин \${name}">
                    \${bodyPart ? \`<img class="layer body" alt="body" src="\${bodyPart.path}">\` : ''}
                    \${facePart ? \`<img class="layer face" alt="face" src="\${facePart.path}">\` : ''}
                    \${clothesPart ? \`<img class="layer clothes" alt="clothes" src="\${clothesPart.path}">\` : ''}
                    \${othersPart ? \`<img class="layer others" alt="others" src="\${othersPart.path}">\` : ''}
                  </div>
                  <div class="name">\${name}</div>
                </div>\`;
              }).join('')}
            </div>
            <button class="carousel-btn" id="presetsNext">›</button>
          </div>
          <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn secondary" id="toDetailedBtn">Перейти к детальной настройке</button>
          </div>
        \`;

        grid.appendChild(section);

        const getPresetParts = (presetKey) => {
          const preset = findPresetByKey(presetKey);
          if (!preset) return [];
          return ['body', 'face', 'clothes', 'others']
            .map(layer => {
              const part = preset.parts[layer];
              return part ? { skinType: layer, skinId: part.id } : null;
            })
            .filter(Boolean);
        };

        const getMissingParts = (presetKey) => {
          const parts = getPresetParts(presetKey);
          return parts.filter(p => isSkinLocked(p.skinType, p.skinId));
        };

        const getMissingTotalPrice = (presetKey) => {
          return getMissingParts(presetKey).reduce((sum, p) => sum + (getSkinPrice(p.skinType, p.skinId) || 0), 0);
        };

        document.querySelectorAll('.preset-card').forEach(card => {
          const presetKey = card.dataset.presetKey;
          const missing = getMissingParts(presetKey);
          const totalPrice = getMissingTotalPrice(presetKey);
          if (missing.length > 0) {
            card.classList.add('locked');
            // бейдж с ценой
            const badge = document.createElement('div');
            badge.className = 'preset-lock-info';
            badge.textContent = '🔒 ' + totalPrice;
            card.style.position = 'relative';
            card.appendChild(badge);
          }

          card.addEventListener('click', function() {
            const currentMissing = getMissingParts(presetKey);
            const currentTotal = getMissingTotalPrice(presetKey);
            if (currentMissing.length > 0) {
              showPurchasePresetModal(presetKey, currentMissing, currentTotal);
            } else {
              applyPreset(presetKey);
            }
          });
        });

        const toDetailedBtn = document.getElementById('toDetailedBtn');
        if (toDetailedBtn) {
          toDetailedBtn.addEventListener('click', () => {
            loadAvailableParts();
            currentCustomizeView = 'detailed';
            const saveBtn = document.getElementById('saveChangesBtn');
            if (saveBtn) saveBtn.style.display = 'block';
          });
        }

        const track = document.getElementById('presetsGrid');
        const prevBtn = document.getElementById('presetsPrev');
        const nextBtn = document.getElementById('presetsNext');
        if (track && prevBtn && nextBtn) {
          function rotate(direction) {
            if (direction === 'next') {
              const first = track.firstElementChild;
              if (first) { track.appendChild(first); }
            } else {
              const last = track.lastElementChild;
              if (last) { track.insertBefore(last, track.firstElementChild); }
            }
            track.scrollLeft = 0;
          }
          prevBtn.addEventListener('click', () => rotate('prev'));
          nextBtn.addEventListener('click', () => rotate('next'));
        }
      }

      function applyPreset(presetKey) {
        const preset = findPresetByKey(presetKey);
        if (!preset) return;

        selectedPreset = {
          key: presetKey,
          body: preset.parts.body ? preset.parts.body.id : null,
          face: preset.parts.face ? preset.parts.face.id : null,
          clothes: preset.parts.clothes ? preset.parts.clothes.id : null,
          others: preset.parts.others ? preset.parts.others.id : null
        };

        // Применяем скин сразу (без перехода в детальную настройку)
        const selections = {};
        ['body', 'face', 'clothes', 'others'].forEach(layer => {
          const partId = selectedPreset[layer];
          if (partId) {
            selections[layer] = partId;
          }
        });
        Object.assign(currentSelections, selections);

        const updates = Object.entries(selections).map(([partType, partId]) => {
          return fetch('/api/avatar/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId, partType, partId })
          });
        });

        (async () => {
          try {
            await Promise.all(updates);
            await fetch('/api/avatar/clear-cache', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: userId })
            });
            try {
              await fetch('/api/avatar/update-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: userId, streamerId: userId })
              });
            } catch (_) {}
            // Обновляем страницу, чтобы показать применённые изменения
            location.reload();
          } catch (e) {
            console.error('Error applying preset:', e);
            alert('Ошибка при применении скина');
          }
        })();
      }

      // Load current avatar data and pre-select current parts
      async function loadCurrentAvatarData() {
        try {
          const response = await fetch(\`/api/avatar/\${userId}\`);
          const data = await response.json();
          
          if (data.success) {
            const avatar = data.data;

            // Используем данные из базы, а не из selectedPreset, чтобы сохранить все части
            const base = {
              body: avatar.body_skin,
              face: avatar.face_skin,
              clothes: avatar.clothes_type,
              others: avatar.others_type
            };

            // Заполняем currentSelections всеми текущими частями
            [['body', base.body], ['face', base.face], ['clothes', base.clothes], ['others', base.others]].forEach(([layer, value]) => {
              if (!value) return;
              // Сохраняем в currentSelections
              currentSelections[layer] = value;
              // Выделяем визуально в интерфейсе
              const item = document.querySelector(\`[data-layer="\${layer}"][data-part-id="\${value}"]\`);
              if (item) {
                document.querySelectorAll(\`[data-layer="\${layer}"]\`).forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
              }
            });
          }
        } catch (error) {
          console.error('Error loading current avatar data:', error);
        }
      }

      // Save changes
      async function saveChanges() {
        // Убеждаемся, что все части сохранены, даже если пользователь их не менял
        // Загружаем текущие данные аватара, чтобы сохранить все части
        try {
          const avatarResponse = await fetch(\`/api/avatar/\${userId}\`);
          const avatarData = await avatarResponse.json();
          
          // Объединяем текущие данные с выбранными пользователем
          const allSelections = {
            body: currentSelections.body || (avatarData.success ? avatarData.data.body_skin : null),
            face: currentSelections.face || (avatarData.success ? avatarData.data.face_skin : null),
            clothes: currentSelections.clothes || (avatarData.success ? avatarData.data.clothes_type : null),
            others: currentSelections.others || (avatarData.success ? avatarData.data.others_type : null)
          };
          
          // Фильтруем null значения
          const selectionsToSave = {};
          ['body', 'face', 'clothes', 'others'].forEach(layer => {
            if (allSelections[layer]) {
              selectionsToSave[layer] = allSelections[layer];
            }
          });

          // Сохраняем все части
          const promises = Object.keys(selectionsToSave).map(layer => {
            const partId = selectionsToSave[layer];
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
      const backBtn = document.getElementById('backBtn');
      let currentCustomizeView = 'presets'; // 'presets' | 'detailed'

      customizeBtn.addEventListener('click', async () => {
        modal.style.display = 'block';
        await loadLockedSkins();
        await loadCoins();
        try {
          const resp = await fetch('/api/avatar/parts');
          const data = await resp.json();
          if (data && data.success) {
            availableParts = data.data || {};
          }
        } catch (_) {}
        renderPresetInterface();
        currentCustomizeView = 'presets';
      });

      closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });

      if (backBtn) {
        backBtn.addEventListener('click', () => {
          if (currentCustomizeView === 'detailed') {
            renderPresetInterface();
            currentCustomizeView = 'presets';
            const saveBtn = document.getElementById('saveChangesBtn');
            if (saveBtn) saveBtn.style.display = 'none';
          } else {
            modal.style.display = 'none';
          }
        });
      }

      // Save changes button handler
      const saveChangesBtn = document.getElementById('saveChangesBtn');
      if (saveChangesBtn) {
        saveChangesBtn.addEventListener('click', async () => {
          await saveChanges();
        });
      }

      // Purchase modal handlers
      const purchaseModal = document.getElementById('purchaseModal');
      const purchaseClose = document.getElementById('purchaseClose');
      const purchaseCancel = document.getElementById('purchaseCancel');
      const purchaseConfirm = document.getElementById('purchaseConfirm');

      // Purchase preset modal handlers
      const purchasePresetModal = document.getElementById('purchasePresetModal');
      const purchasePresetClose = document.getElementById('purchasePresetClose');
      const purchasePresetCancel = document.getElementById('purchasePresetCancel');
      const purchasePresetConfirm = document.getElementById('purchasePresetConfirm');

      purchaseClose.addEventListener('click', () => {
        purchaseModal.style.display = 'none';
      });

      purchaseCancel.addEventListener('click', () => {
        purchaseModal.style.display = 'none';
      });

      purchaseConfirm.addEventListener('click', purchaseSkin);

      // Preset purchase handlers
      purchasePresetClose.addEventListener('click', () => {
        purchasePresetModal.style.display = 'none';
      });
      purchasePresetCancel.addEventListener('click', () => {
        purchasePresetModal.style.display = 'none';
      });
      purchasePresetConfirm.addEventListener('click', purchasePreset);

      // Close modal when clicking outside
      window.addEventListener('click', (event) => {
        if (event.target === modal) {
          modal.style.display = 'none';
        }
        if (event.target === purchaseModal) {
          purchaseModal.style.display = 'none';
        }
        if (event.target === purchasePresetModal) {
          purchasePresetModal.style.display = 'none';
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
          // Show all gifts with their counts using real available gifts
          const allGifts = [];
          giftStats.forEach(stat => {
            const giftType = stat.gift_type;
            const availableGiftsForType = availableGifts[\`gift_\${giftType}\`] || [];
            
            // Create gifts based on available files and counts
            for (let i = 0; i < stat.total_gifts; i++) {
              const giftFile = availableGiftsForType[i % availableGiftsForType.length];
              if (giftFile) {
                // Получаем название подарка из объекта giftNames
                const giftId = giftFile.id.replace(\`gift_\${giftType}_\`, '');
                const giftName = giftNames[giftType] && giftNames[giftType][giftId] ? giftNames[giftType][giftId] : \`Подарок \${giftType} #\${giftId}\`;
                console.log('Creating gift:', { giftType, giftId, giftName, giftFileId: giftFile.id, giftNamesForType: giftNames[giftType] });
                
                allGifts.push({
                  gift_type: giftType,
                  gift_id: giftFile.id,
                  gift_path: giftFile.path,
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
          // Show unique gifts with real available gifts
          filteredGifts = filteredGifts.map(gift => {
            const giftType = gift.gift_type;
            const availableGiftsForType = availableGifts[\`gift_\${giftType}\`] || [];
            const giftFile = availableGiftsForType.find(f => f.id === \`gift_\${giftType}_\${gift.gift_id}\`) || availableGiftsForType[0];
            
            // Используем уже существующее название из giftsWithNames
            console.log('Unique gift:', { giftType, giftId: gift.gift_id, existingName: gift.name });
            
            return {
              ...gift,
              gift_path: giftFile ? giftFile.path : \`/parts/gift_\${giftType}/gift_\${giftType}_\${gift.gift_id}.png\`,
              rarity_order: rarityOrder[giftType] || 0
              // Не перезаписываем name, используем уже существующий
            };
          });
          
          // Sort by rarity (rare first, then uncommon, then common)
          filteredGifts = filteredGifts.sort((a, b) => b.rarity_order - a.rarity_order);
        } else {
          // Filter by specific type and add real paths
          filteredGifts = filteredGifts
            .filter(gift => gift.gift_type === type)
            .map(gift => {
              const giftType = gift.gift_type;
              const availableGiftsForType = availableGifts[\`gift_\${giftType}\`] || [];
              const giftFile = availableGiftsForType.find(f => f.id === \`gift_\${giftType}_\${gift.gift_id}\`) || availableGiftsForType[0];
              
              // Используем уже существующее название из giftsWithNames
              console.log('Specific type gift:', { giftType, giftId: gift.gift_id, existingName: gift.name });
              
              return {
                ...gift,
                gift_path: giftFile ? giftFile.path : \`/parts/gift_\${giftType}/gift_\${giftType}_\${gift.gift_id}.png\`
                // Не перезаписываем name, используем уже существующий
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
