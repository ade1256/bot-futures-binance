module.exports = app => {
  const controller = require("../controllers/tradingview.controller")
  app.post("/tradingview/place-order", controller.placeOrder);
  app.post("/tradingview/stopall", controller.stopAll);
};