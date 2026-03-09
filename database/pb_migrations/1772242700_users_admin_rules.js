migrate((app) => {
  const dao = app.dao();
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_");

  // Actualizar reglas de acceso
  collection.listRule = "@request.auth.id != '' && (@request.auth.role = 'administrador' || @request.auth.role = 'administrador')";
  collection.viewRule = "@request.auth.id != ''";
  collection.createRule = "@request.auth.id != ''";
  collection.updateRule = "@request.auth.id = id || (@request.auth.role = 'administrador' || @request.auth.role = 'administrador')";
  collection.deleteRule = "@request.auth.id != '' && (@request.auth.role = 'administrador' || @request.auth.role = 'administrador')";

  return dao.saveCollection(collection);
}, (app) => {
  const dao = app.dao();
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_");

  // Restaurar reglas por defecto en rollback
  collection.listRule = null;
  collection.viewRule = null;
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;

  return dao.saveCollection(collection);
});
