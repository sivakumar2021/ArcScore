module.exports = {
  name: '1781029942_rename_dimensions',
  up: async (client) => {
    await client.query(`UPDATE dimensions SET name = 'Physical' WHERE key = 'fitness'`);
    await client.query(`UPDATE dimensions SET name = 'Mental' WHERE key = 'mental_health'`);
  }
};