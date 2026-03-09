migrate((app) => {
  const dao = app.dao();
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_");

  if (!collection) {
    console.error("No se encontró la colección _pb_users_auth_");
    return;
  }

  // Verificar si el campo ya existe
  const existingField = collection.schema.getFieldByName("nombre");
  if (existingField) {
    console.log("El campo 'nombre' ya existe, omitiendo creación");
    return; // El campo ya existe, no hacer nada
  }

  // Añadir campo 'nombre' como text usando objeto simple
  collection.schema.addField({
    "system": false,
    "id": "nombre",
    "name": "nombre",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": 80,
      "pattern": ""
    }
  });

  return dao.saveCollection(collection);
}, (app) => {
  const dao = app.dao();
  const collection = dao.findCollectionByNameOrId("_pb_users_auth_");

  if (!collection) {
    return;
  }

  // Eliminar campo 'nombre' en rollback
  const existingField = collection.schema.getFieldByName("nombre");
  if (existingField) {
    collection.schema.removeField("nombre");
    return dao.saveCollection(collection);
  }
});
