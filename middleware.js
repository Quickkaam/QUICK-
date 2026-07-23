// middleware.js – Rewrites clean URLs to .html files for Live Server
module.exports = function(req, res, next) {
  // Map clean routes → actual files
  const routes = {
    '/': '/index.html',
    '/about': '/about.html',
    '/services': '/services.html',
    '/brand-building': '/brand-building.html',
    '/book-online': '/book-online.html',
    '/contact': '/contact.html',
    '/404': '/404.html'
  };

  // If the requested URL matches a route, rewrite it
  if (routes[req.url]) {
    req.url = routes[req.url];
  }

  // Let Live Server handle the rest
  next();
};