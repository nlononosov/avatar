const YooKassa = require('yookassa');
const crypto = require('crypto');
const { YK_SHOP_ID, YK_SECRET_KEY, BASE_URL } = require('./config');

// Инициализация ЮKassa
const yooKassa = new YooKassa({
  shopId: YK_SHOP_ID,
  secretKey: YK_SECRET_KEY,
});

// Проверяем настройки
console.log('YooKassa config:', {
  shopId: YK_SHOP_ID ? 'Set' : 'Missing',
  secretKey: YK_SECRET_KEY ? 'Set' : 'Missing',
  baseUrl: BASE_URL
});

// Хранилище обработанных платежей (в реальном проекте лучше использовать Redis или БД)
const processedPayments = new Set();

// Хранилище соответствия внутренних ID и ID платежей YooKassa
const paymentIdMapping = new Map();

// Создание платежа
async function createPayment(userId, amount) {
  const paymentId = crypto.randomUUID();
  const returnUrl = `${BASE_URL}/payment/success?payment_id=${paymentId}`;
  
  // Минимальная сумма для ЮKassa - 1 рубль
  const rubleAmount = Math.max(1, amount);
  
  const paymentData = {
    amount: {
      value: rubleAmount.toFixed(2),
      currency: 'RUB'
    },
    confirmation: {
      type: 'redirect',
      return_url: returnUrl
    },
    description: `Пополнение баланса на ${amount} монет`,
    metadata: {
      userId: userId,
      amount: amount.toString(),
      paymentId: paymentId
    },
    capture: true // Автоматическое подтверждение платежа
  };

  try {
    const response = await yooKassa.createPayment(paymentData);
    console.log('YooKassa payment created:', response);
    
    // Сохраняем соответствие между нашим внутренним ID и ID платежа YooKassa
    paymentIdMapping.set(paymentId, response.id);
    
    if (response.status === 'pending' && response.confirmation) {
      return response.confirmation.confirmation_url;
    }
    throw new Error(`Payment creation failed. Status: ${response.status}`);
  } catch (error) {
    console.error('YooKassa payment creation error:', error);
    console.error('Error details:', {
      message: error.message,
      id: error.id,
      code: error.code,
      parameter: error.parameter
    });
    throw new Error('Ошибка создания платежа. Попробуйте позже.');
  }
}

// Получение реального ID платежа YooKassa по нашему внутреннему ID
function getYooKassaPaymentId(internalPaymentId) {
  return paymentIdMapping.get(internalPaymentId);
}

// Проверка статуса платежа
async function checkPaymentStatus(internalPaymentId) {
  try {
    // Получаем реальный ID платежа YooKassa
    const yooKassaPaymentId = getYooKassaPaymentId(internalPaymentId);
    
    if (!yooKassaPaymentId) {
      throw new Error(`Payment ID not found: ${internalPaymentId}`);
    }
    
    const response = await yooKassa.getPayment(yooKassaPaymentId);
    return {
      status: response.status,
      paid: response.paid,
      amount: response.amount,
      metadata: response.metadata
    };
  } catch (error) {
    console.error('YooKassa payment status check error:', error);
    throw error;
  }
}

// Проверка, был ли платеж уже обработан
function isPaymentProcessed(paymentId) {
  return processedPayments.has(paymentId);
}

// Отметить платеж как обработанный
function markPaymentProcessed(paymentId) {
  processedPayments.add(paymentId);
}

// Обработка webhook от ЮKassa
function handleWebhook(req, res) {
  const { event, object } = req.body;
  
  if (event === 'payment.succeeded') {
    const yooKassaPaymentId = object.id;
    const metadata = object.metadata;
    
    if (metadata && metadata.userId && metadata.amount) {
      // Находим наш внутренний ID по ID платежа YooKassa
      let internalPaymentId = null;
      for (const [internalId, ykId] of paymentIdMapping.entries()) {
        if (ykId === yooKassaPaymentId) {
          internalPaymentId = internalId;
          break;
        }
      }
      
      if (internalPaymentId && !isPaymentProcessed(internalPaymentId)) {
        // Отмечаем как обработанный
        markPaymentProcessed(internalPaymentId);
        
        console.log(`Payment ${yooKassaPaymentId} (internal: ${internalPaymentId}) succeeded for user ${metadata.userId}, amount: ${metadata.amount}`);
        
        // Отправляем запрос на начисление монет
        const { addUserCoins } = require('../db');
        try {
          addUserCoins(metadata.userId, parseInt(metadata.amount));
          console.log(`Coins added for user ${metadata.userId}: ${metadata.amount}`);
        } catch (error) {
          console.error('Error adding coins after payment:', error);
        }
      }
    }
  }
  
  res.status(200).send('OK');
}

// Валидация webhook (проверка подписи)
function validateWebhook(req, res, next) {
  const signature = req.headers['x-yookassa-signature'];
  const body = JSON.stringify(req.body);
  
  if (!signature) {
    return res.status(400).send('Missing signature');
  }
  
  // В реальном проекте здесь должна быть проверка подписи
  // const expectedSignature = crypto
  //   .createHmac('sha256', process.env.YOOKASSA_WEBHOOK_SECRET)
  //   .update(body)
  //   .digest('hex');
  
  // if (signature !== expectedSignature) {
  //   return res.status(400).send('Invalid signature');
  // }
  
  next();
}

module.exports = {
  createPayment,
  checkPaymentStatus,
  getYooKassaPaymentId,
  isPaymentProcessed,
  markPaymentProcessed,
  handleWebhook,
  validateWebhook
};
