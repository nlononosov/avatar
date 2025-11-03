const { startPolling, stopPolling, fetchDonations } = require('../lib/donationalerts-poll');

function registerDonationAlertsRoute(app) {
  // TODO: Webhook endpoint for DonationAlerts (temporarily disabled)
  // app.post('/webhook/donationalerts', (req, res) => {
  //   // TODO: Implement webhook signature verification
  //   res.status(501).json({ error: 'Webhook not implemented yet' });
  // });
  
}

module.exports = { registerDonationAlertsRoute };
