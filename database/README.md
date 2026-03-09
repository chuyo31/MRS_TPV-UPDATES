# Base de Datos PocketBase

Esta carpeta contiene el ejecutable de PocketBase y las migraciones necesarias.

## Archivos Requeridos

- `pocketbase.exe` - Ejecutable de PocketBase para Windows (descargar desde https://pocketbase.io/docs/)
- `pb_migrations/` - Carpeta con las migraciones de esquema

## Migraciones Incluidas

1. `1772242500_updated_users.js` - Añade campo 'role' a usuarios
2. `1772242600_add_user_nombre.js` - Añade campo 'nombre' a usuarios
3. `1772242700_users_admin_rules.js` - Define reglas de acceso admin
4. `1772242800_users_admin_rules_case_insensitive.js` - Reglas case-insensitive

## Instrucciones

1. Descarga `pocketbase.exe` desde https://pocketbase.io/docs/
2. Colócalo en esta carpeta (`database/pocketbase.exe`)
3. Las migraciones se ejecutarán automáticamente al iniciar la aplicación
