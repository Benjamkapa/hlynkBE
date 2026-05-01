require('ts-node/register');
const { getSystemStats } = require('./src/modules/admin/admin.service.ts');

getSystemStats('HOURLY')
  .then(console.log)
  .catch(e => {
    console.error('ERROR OCCURRED:');
    console.error(e);
  })
  .finally(() => process.exit(0));
