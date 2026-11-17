# ============================================================================
#  Imagen de Smart Mind (API + página web) para la Raspberry.
#
#  Este archivo es la RECETA para armar la imagen: qué sistema base usar,
#  qué copiar y qué instalar. No arranca nada por sí solo; eso lo hace
#  docker-compose.yml. Se construye con:  docker compose build
#
#  Tiene DOS ETAPAS (multi-stage):
#    1) "deps": instala las dependencias y compila better-sqlite3. Necesita
#       Python y un compilador de C, que pesan bastante.
#    2) Imagen final: copia lo ya compilado de la etapa 1 y descarta las
#       herramientas de compilación. Así la imagen final queda liviana.
# ============================================================================


# ---------------------------------------------------------------------------
#  ETAPA 1: dependencias
# ---------------------------------------------------------------------------

# Parte de la imagen oficial de Node 22 sobre Debian 12 ("bookworm") en su
# versión reducida ("slim"). Docker descarga la variante para el procesador
# donde se construye (ARM64 en la Pi). "AS deps" le da nombre a esta etapa
# para poder copiar cosas de ella más abajo.
FROM node:22-bookworm-slim AS deps

# Instala las herramientas que necesita node-gyp para compilar el código C
# de better-sqlite3:
#   python3  -> node-gyp está escrito en parte en Python
#   make     -> organiza los pasos de compilación
#   g++      -> el compilador de C/C++
# --no-install-recommends evita paquetes extra. Al final se borra la lista
# de paquetes descargada (/var/lib/apt/lists) para no dejar basura.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Carpeta de trabajo dentro de la imagen. Los comandos siguientes se ejecutan
# aquí (como hacer "cd /app/Api"). Si no existe, Docker la crea.
WORKDIR /app/Api

# Copia SOLO package.json y package-lock.json (todavía no el código).
# Truco de caché: Docker guarda el resultado de cada paso. Si estos dos
# archivos no cambiaron, en la próxima construcción reutiliza el "npm ci"
# anterior y no recompila nada, aunque hayas cambiado el código.
COPY Api/package*.json ./

# Instala las dependencias DENTRO de la imagen (aquí se compila better-sqlite3
# para la Pi).
#   ci          -> instala exactamente las versiones de package-lock.json
#   --omit=dev  -> no instala dependencias de desarrollo
RUN npm ci --omit=dev


# ---------------------------------------------------------------------------
#  ETAPA 2: imagen final (la que realmente se ejecuta)
# ---------------------------------------------------------------------------

# Empieza de nuevo desde una imagen limpia de Node 22: no trae Python ni g++.
# Todo lo de la etapa 1 queda descartado, salvo lo que se copie con --from.
FROM node:22-bookworm-slim

# Misma carpeta de trabajo que en la etapa 1.
WORKDIR /app/Api

# La imagen trae un usuario sin privilegios llamado "node" (uid 1000, el mismo
# número que tu usuario meclab en la Pi). Le damos la propiedad de /app para
# que la app pueda trabajar ahí sin ser root.
RUN chown node:node /app /app/Api

# Trae de la etapa "deps" la carpeta node_modules ya compilada.
# --chown=node:node deja los archivos a nombre del usuario "node".
COPY --chown=node:node --from=deps /app/Api/node_modules ./node_modules

# Copia el backend (server.js, src/, whapi.js...) desde tu proyecto a
# /app/Api. Lo que esté en .dockerignore (node_modules, .env, bases .db)
# NO se copia.
COPY --chown=node:node Api/ ./

# Copia la página web a "/app/Homepage". server.js la sirve desde
# "../Homepage" relativo a su carpeta, por eso queda al lado de /app/Api.
COPY --chown=node:node ["Homepage", "/app/Homepage"]

# Variables de entorno fijas de la imagen:
#   NODE_ENV=production -> modo producción para Express y librerías
#   PORT=3000           -> puerto donde escucha server.js
#   TZ=America/Bogota   -> hora de Colombia para fechas y recordatorios
#   DB_PATH=...         -> dónde guarda SQLite la base. /app/datos se monta
#                          desde la Pi (ver volumes en docker-compose.yml),
#                          así la base sobrevive aunque se rehaga la imagen.
# Las variables secretas (tokens, JWT) NO van aquí: llegan desde Api/.env
# a través de docker-compose.yml.
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=America/Bogota \
    DB_PATH=/app/datos/smartmind.db

# A partir de aquí todo corre como el usuario "node" y no como root. Si alguien
# llegara a explotar una falla de la app, no tendría permisos de administrador
# dentro del contenedor.
USER node

# Documenta que la app escucha en el puerto 3000. No abre nada hacia afuera
# por sí solo; es informativo.
EXPOSE 3000

# Comando que se ejecuta al arrancar el contenedor: inicia el servidor.
# (Equivale a "npm start", pero sin npm de por medio: más liviano y las
# señales de apagado le llegan directo a Node.)
CMD ["node", "server.js"]
