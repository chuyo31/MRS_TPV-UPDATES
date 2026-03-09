migrate((app) => {
  const dao = app.dao();
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_");

  // Actualizar reglas con comparación case-insensitive usando LOWER()
  // PocketBase soporta funciones SQL en reglas
  collection.listRule = "@request.auth.id != '' && (LOWER(@request.auth.role) = 'administrador')";
  collection.viewRule = "@request.auth.id != ''";
  collection.createRule = "@request.auth.id != ''";
  collection.updateRule = "@request.auth.id = id || (LOWER(@request.auth.role) = 'administrador')";
  collection.deleteRule = "@request.auth.id != '' && (LOWER(@request.auth.role) = 'administrador')";

  return dao.saveCollection(collection);
}, (app) => {
  const dao = app.dao();
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_");

  // Restaurar reglas anteriores en rollback
  collection.listRule = "@request.auth.id != '' && (@request.auth.role = 'administrador' || @request.auth.role = 'administrador')";
  collection.viewRule = "@request.auth.id != ''";
  collection.createRule = "@request.auth.id != ''";
  collection.updateRule = "@request.auth.id = id || (@request.auth.role = 'administrador' || @request.auth.role = 'administrador')";
  collection.deleteRule = "@request.auth.id != '' && (@request.auth.role = 'administrador' || @request.auth.role = 'administrador')";

  return dao.saveCollection(collection);
});
