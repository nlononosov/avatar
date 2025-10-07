const { getUserByTwitchId, addUserCoins } = require('../db');
const { checkPaymentStatus, isPaymentProcessed, markPaymentProcessed } = require('../lib/yookassa');

function registerPaymentSuccessRoute(app) {
  // Страница успешной оплаты
  app.get('/payment/success', async (req, res) => {
    const { payment_id } = req.query;
    
    if (!payment_id) {
      return res.status(400).send(`
<!doctype html>
<html lang="ru">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Ошибка оплаты</title>
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
    <div class="error-icon">❌</div>
    <h1>Ошибка оплаты</h1>
    <p>Неверный параметр платежа</p>
    <a href="/my-avatar" class="back-btn">← Назад к аватару</a>
  </div>
</body>
</html>
      `);
    }

    try {
      // Проверяем статус платежа
      // В YooKassa payment_id - это ID платежа в их системе, а не наш внутренний paymentId
      const paymentInfo = await checkPaymentStatus(payment_id);
      
      if (paymentInfo.status === 'succeeded' && paymentInfo.paid) {
        const userId = paymentInfo.metadata.userId;
        const amount = parseInt(paymentInfo.metadata.amount);
        
        // Проверяем, что платеж еще не был обработан
        if (!isPaymentProcessed(payment_id)) {
          // Начисляем монеты
          const newCoins = addUserCoins(userId, amount);
          
          // Отмечаем платеж как обработанный
          markPaymentProcessed(payment_id);
          
          // Получаем информацию о пользователе
          const user = getUserByTwitchId(userId);
          const displayName = user ? user.display_name : 'Пользователь';
          
          res.send(`
<!doctype html>
<html lang="ru">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Оплата успешна</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display: flex; align-items: center; justify-content: center; }
  .container { text-align: center; padding: 40px; max-width: 500px; }
  .success-icon { font-size: 64px; margin-bottom: 20px; }
  h1 { color: #10b981; margin-bottom: 20px; }
  p { color: #9ca3af; margin-bottom: 30px; }
  .coins-info { background: #1f2937; padding: 20px; border-radius: 12px; margin: 20px 0; border: 2px solid #fbbf24; }
  .coins-amount { font-size: 24px; font-weight: bold; color: #fbbf24; margin: 10px 0; }
  .back-btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; height: 48px; padding: 0 18px; background: #7c3aed; color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 16px; }
  .back-btn:hover { background: #6d28d9; }
  .coins-icon { 
    font-size: 20px; 
    animation: coinSpin 2s ease-in-out infinite; 
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
  }
  @keyframes coinSpin {
    0%, 100% { transform: rotateY(0deg); }
    50% { transform: rotateY(180deg); }
  }
</style>
<body>
  <div class="container">
    <div class="success-icon">✅</div>
    <h1>Оплата успешна!</h1>
    <p>Спасибо за пополнение баланса, <b>${displayName}</b>!</p>
    <div class="coins-info">
      <div>Начислено монет:</div>
      <div class="coins-amount">
        <span class="coins-icon">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <defs>
              <linearGradient id="coinGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
                <stop offset="50%" style="stop-color:#FFA500;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#FF8C00;stop-opacity:1" />
              </linearGradient>
            </defs>
            <circle cx="10" cy="10" r="9" fill="url(#coinGradient)" stroke="#B8860B" stroke-width="1"/>
            <text x="10" y="14" text-anchor="middle" font-family="Arial" font-size="12" font-weight="bold" fill="#8B4513">₽</text>
          </svg>
        </span>
        ${amount.toLocaleString('ru-RU')}
      </div>
      <div>Новый баланс: ${newCoins.toLocaleString('ru-RU')} монет</div>
    </div>
    <a href="/my-avatar" class="back-btn">← Вернуться к аватару</a>
  </div>
</body>
</html>
          `);
        } else {
          // Платеж уже был обработан
          res.send(`
<!doctype html>
<html lang="ru">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Платеж уже обработан</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display: flex; align-items: center; justify-content: center; }
  .container { text-align: center; padding: 40px; }
  .info-icon { font-size: 64px; margin-bottom: 20px; }
  h1 { color: #3b82f6; margin-bottom: 20px; }
  p { color: #9ca3af; margin-bottom: 30px; }
  .back-btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; height: 48px; padding: 0 18px; background: #7c3aed; color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 16px; }
  .back-btn:hover { background: #6d28d9; }
</style>
<body>
  <div class="container">
    <div class="info-icon">ℹ️</div>
    <h1>Платеж уже обработан</h1>
    <p>Монеты уже были начислены на ваш баланс</p>
    <a href="/my-avatar" class="back-btn">← Вернуться к аватару</a>
  </div>
</body>
</html>
          `);
        }
      } else {
        // Платеж не прошел
        res.send(`
<!doctype html>
<html lang="ru">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Оплата не прошла</title>
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
    <div class="error-icon">❌</div>
    <h1>Оплата не прошла</h1>
    <p>Платеж не был завершен или был отклонен</p>
    <a href="/my-avatar" class="back-btn">← Попробовать снова</a>
  </div>
</body>
</html>
        `);
      }
    } catch (error) {
      console.error('Error processing payment success:', error);
      res.status(500).send(`
<!doctype html>
<html lang="ru">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Ошибка обработки платежа</title>
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
    <div class="error-icon">⚠️</div>
    <h1>Ошибка обработки платежа</h1>
    <p>Произошла ошибка при обработке платежа. Обратитесь в поддержку.</p>
    <a href="/my-avatar" class="back-btn">← Назад к аватару</a>
  </div>
</body>
</html>
      `);
    }
  });
}

module.exports = { registerPaymentSuccessRoute };
