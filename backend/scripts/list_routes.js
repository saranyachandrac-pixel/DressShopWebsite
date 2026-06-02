const app = require('../src/app');

function listRoutes(stack, path = '') {
  const routes = [];
  stack.forEach((layer) => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      routes.push({ path: path + layer.route.path, methods });
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const newPath = layer.regexp && layer.regexp.source
        ? (layer.regexp.source.replace('^\\', '').replace('\\/?(?=\\/|$)', '') || '')
        : '';
      routes.push(...listRoutes(layer.handle.stack, path + (newPath ? `/${newPath}` : '')));
    }
  });
  return routes;
}

const routes = listRoutes(app._router.stack);
console.log(JSON.stringify(routes, null, 2));
