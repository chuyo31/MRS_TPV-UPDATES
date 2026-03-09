migrate((app) => {
  const dao = app.dao();
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_");

  if (!collection) {
    console.error("No se encontró la colección _pb_users_auth_");
    return;
  }

  // Verificar si el campo ya existe
  const existingField = collection.schema.getFieldByName("role");
  if (existingField) {
    console.log("El campo 'role' ya existe, omitiendo creación");
    return; // El campo ya existe, no hacer nada
  }

  // Añadir campo 'role' como select usando objeto simple
  // PocketBase acepta objetos simples para campos en migraciones
  collection.schema.addField({
    "system": false,
    "id": "role",
    "name": "role",
    "type": "select",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSelect": 1,
      "values": [
        "administrador",
        "tecnico",
        "dependiente"
      ]
    }
  });

  return dao.saveCollection(collection);
}, (app) => {
  const dao = app.dao();
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_");

  if (!collection) {
    return;
  }

  // Eliminar campo 'role' en rollback
  const existingField = collection.schema.getFieldByName("role");
  if (existingField) {
    collection.schema.removeField("role");
    return dao.saveCollection(collection);
  }
});
