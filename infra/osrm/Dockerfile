# Serveur OSRM autonome (routage voiture, extrait OSM Tunisie) pour Cloud Run. Les données sont téléchargées et préparées
# à la construction de l'image : pas de fichier à fournir.
#   gcloud builds submit infra/osrm --tag <registre>/vtc-osrm
FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS build
ADD https://download.geofabrik.de/africa/tunisia-latest.osm.pbf /data/tunisia.osm.pbf
RUN osrm-extract -p /opt/car.lua /data/tunisia.osm.pbf \
 && osrm-partition /data/tunisia.osrm \
 && osrm-customize /data/tunisia.osrm \
 && rm /data/tunisia.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --from=build /data /data
# Cloud Run fournit PORT
CMD ["sh", "-c", "osrm-routed --algorithm mld --port ${PORT:-8080} /data/tunisia.osrm"]
