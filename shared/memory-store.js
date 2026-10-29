// Isolated local storage for demos and domain tests; never used by the cloud API.
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
function createMemoryStore(initial, persist) {
  let data = copy(initial) || { clubs: {}, members: {}, tasks: {}, invites: {} };
  let queue = Promise.resolve();
  const makeAdapter = state => ({
    async get(collection, id) { return copy(state[collection][id] || null); },
    async find(collection, fields) {
      return Object.values(state[collection]).filter(doc => Object.keys(fields).every(key => doc[key] === fields[key])).map(copy);
    },
    async put(collection, id, value) { state[collection][id] = Object.assign({}, copy(value), { _id: id }); },
    async remove(collection, id) { delete state[collection][id]; }
  });
  const store = {
    get: (...args) => makeAdapter(data).get(...args),
    find: (...args) => makeAdapter(data).find(...args),
    async findSince(collection, fields, since) {
      return (await makeAdapter(data).find(collection, fields)).filter(doc => (doc.syncVersion || 0) > since);
    },
    snapshot: () => copy(data),
    transaction(work) {
      const operation = queue.then(async () => {
        const draft = copy(data);
        const result = await work(makeAdapter(draft));
        if (persist) persist(copy(draft));
        data = draft;
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
  return store;
}
module.exports = { createMemoryStore };
