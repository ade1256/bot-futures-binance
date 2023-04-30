require('dotenv').config()
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const app = express();
const moment = require('moment')
const morgan = require('morgan')

morgan.token('date', (req, res) => {
    return moment().format('YYYY-MM-DD HH:mm:ss');
})
app.use(morgan('[:date] :method :url | :status | :response-time ms | :remote-addr ":user-agent"'))


// CORS
app.use(cors());
app.enable("trust proxy");

// parse requests of content-type - application/json
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.json({ message: "Alon alon ketuku Civic type R" });
});

// ROUTES
require("./routes/tradingview.route")(app)

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});
