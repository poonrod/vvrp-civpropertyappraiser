require('dotenv').config();
const { connectDb } = require('./config/db');

const port = process.env.PORT || 3000;

async function main() {
  await connectDb();
  const app = require('./app');
  app.listen(port, () => console.log(`SAPA running on port ${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
