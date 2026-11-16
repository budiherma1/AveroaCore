export const AppProvider = {
  openapi(doc, { routes }) {
    doc.info.title = 'Fixture API';
    doc['x-route-count'] = routes.length;
    return doc;
  },
};
