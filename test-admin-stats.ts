import { getSystemStats } from './src/modules/admin/admin.service';

getSystemStats()
  .then(console.log)
  .catch(console.error);
