const { adminRouter } = require('../src/routes/taxonomy');

function printGenderLayers() {
  const layers = adminRouter.stack.filter(l => l.route && l.route.path && String(l.route.path).includes('gender'));
  console.log('Found layers:', layers.length);
  layers.forEach((l, i) => {
    console.log(i, 'path:', l.route.path, 'methods:', Object.keys(l.route.methods));
  });
}

printGenderLayers();
