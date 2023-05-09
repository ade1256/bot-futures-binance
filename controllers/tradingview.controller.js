const Binance = require("node-binance-api");
const binance = new Binance().options({
  APIKEY: process.env.API_KEY,
  APISECRET: process.env.API_SECRET,
  test: process.env.TEST,
  hedgeMode: process.env.HEDEMODE,
});
const { jsonResponse, jsonError } = require("../helper");

const closeAllPositions = async (pair) => {
  try {
    const positions = await binance.futuresPositionRisk();
    const symbolInfo = positions.find((s) => s.symbol === pair);
    if (parseFloat(symbolInfo.positionAmt) !== 0) {
      const symbol = symbolInfo.symbol;
      const side = parseFloat(symbolInfo.positionAmt) > 0 ? "SELL" : "BUY";
      const quantity = Math.abs(parseFloat(symbolInfo.positionAmt));
      side === "SELL"
        ? await binance.futuresMarketSell(symbol, quantity)
        : await binance.futuresMarketBuy(symbol, quantity);
    }
    return true;
  } catch (error) {
    return false;
  }
};

const futuresCalculateQty = async (symbolInfo, price, amount) => {
  const lotSizeFilter = symbolInfo.filters.find(
    (f) => f.filterType === "LOT_SIZE"
  );
  const stepSize = parseFloat(lotSizeFilter.stepSize);

  let qty;

  qty = amount / price;
  qty = parseFloat(qty.toFixed(8));
  qty = Math.floor(qty / stepSize) * stepSize;

  return qty;
};

const getStopLossTakeProfit = async (
  type,
  priceLimit,
  rrr,
  basedTick,
  tickSize,
  symbol
) => {

  if(symbol === "SOLUSDT") tickSize = 0.001


  let takeProfitPrice = await binance.roundTicks(
    parseFloat(priceLimit) + (rrr * basedTick * tickSize),
    tickSize
  );
  let stopPrice = await binance.roundTicks(
    parseFloat(priceLimit) -( basedTick * tickSize),
    tickSize
  );

  if (type === "SELL" || type === "SHORT") {
    takeProfitPrice = await binance.roundTicks(
      parseFloat(priceLimit) - (rrr * basedTick * tickSize),
      tickSize
    );
    stopPrice = await binance.roundTicks(
      parseFloat(priceLimit) + (basedTick * tickSize),
      tickSize
    );
  }

  return {
    takeProfitPrice: takeProfitPrice,
    stopPrice: stopPrice,
  };
};

exports.placeOrder = async (req, res) => {
  const {
    symbol,
    side,
    type,
    quantityUsdt,
    leverage,
    priceLimit,
    rrr = 2,
    basedTick,
  } = req.body;

  const exchangeInfo = await binance.futuresExchangeInfo();
  const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === symbol);
  if (!symbolInfo) {
    throw new Error(`Symbol ${symbol} not found`);
  }

  const tickSize = parseFloat(
    symbolInfo.filters.find((f) => f.filterType === "PRICE_FILTER").tickSize
  );

  const roundedPrice = await binance.roundTicks(
    parseFloat(priceLimit),
    tickSize
  );

  const calculateQty = await futuresCalculateQty(
    symbolInfo,
    parseFloat(priceLimit),
    parseInt(quantityUsdt)
  );

  let priceStop;

  // cancel all order
  const waitCloseAll = await closeAllPositions(symbol);
  await binance.futuresCancelAll(symbol);

  const setLeverage = await binance.futuresLeverage(symbol, parseInt(leverage));

  if (setLeverage.msg) {
    jsonError(res, setLeverage);
  }

  if (waitCloseAll) {
    let order;
    if (side === "BUY" || side === "LONG") {
      if (type === "LIMIT") {
        order = await binance.futuresBuy(symbol, calculateQty, roundedPrice, {
          timeInForce: "GTC",
          type: "LIMIT",
        });
      } else {
        order = await binance.futuresMarketBuy(symbol, calculateQty);
      }

      priceStop = await getStopLossTakeProfit(
        "BUY",
        roundedPrice,
        rrr,
        basedTick,
        tickSize,
        symbol
      );
      const orderSL = await binance.futuresOrder(
        "SELL",
        symbol,
        calculateQty,
        false,
        {
          type: "STOP_MARKET",
          newOrderRespType: "FULL",
          stopPrice: priceStop.stopPrice,
          closePosition: true,
        }
      );
      const orderTP = await binance.futuresOrder(
        "SELL",
        symbol,
        calculateQty,
        false,
        {
          type: "TAKE_PROFIT_MARKET",
          newOrderRespType: "FULL",
          stopPrice: priceStop.takeProfitPrice,
          closePosition: true,
        }
      );
    } else if (side === "SELL" || side === "SHORT") {
      if (type === "LIMIT") {
        order = await binance.futuresSell(symbol, calculateQty, roundedPrice, {
          timeInForce: "GTC",
          type: "LIMIT",
        });
      } else {
        console.log(`Create new ${side} order`)
        order = await binance.futuresMarketSell(symbol, calculateQty);
        console.log(`${order.status} - Success placing order`)
      }

      priceStop = await getStopLossTakeProfit(
        "SELL",
        roundedPrice,
        rrr,
        basedTick,
        tickSize,
        symbol
      );

      if(order.status === "NEW") {
        console.log("Process - set stoploss...")
        const orderSL = await binance.futuresOrder(
          "BUY",
          symbol,
          calculateQty,
          false,
          {
            type: "STOP_MARKET",
            newOrderRespType: "FULL",
            stopPrice: priceStop.stopPrice,
            closePosition: true,
          }
        );

        console.log(`${orderSL.status} - Success placing stoploss`)
        console.log("Process - set take profit...")
        const orderTP = await binance.futuresOrder(
          "BUY",
          symbol,
          calculateQty,
          false,
          {
            type: "TAKE_PROFIT_MARKET",
            newOrderRespType: "FULL",
            stopPrice: priceStop.takeProfitPrice,
            closePosition: true,
          }
        );
        console.log(`${orderTP.status} - Success placing order take profit`)
      }
    }

    let result = {
      ...order,
      ...req.body,
      ...priceStop,
    };

    if (order.msg) {
      jsonError(res, result);
    } else {
      jsonResponse(res, result);
    }
  }
};

exports.stopAll = async (req, res) => {
  if (!req.body.symbol) {
    jsonError(res, {
      message: "Empty symbol",
    });
  }

  const waitCloseAll = await closeAllPositions(req.body.symbol);

  if (waitCloseAll) {
    jsonResponse(res, { message: "Success stop all" });
  } else {
    jsonError(res, {
      message: "Cannot stop",
    });
  }
};
