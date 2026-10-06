#!/bin/sh
# Prépare les données OSRM (profil voiture) à partir de l'extrait OSM Tunisie. À lancer une fois, depuis infra/osrm :
#   sh prepare.sh
# Nécessite Docker. Le fichier tunisia.osm.pbf vient de https://download.geofabrik.de/africa/tunisia-latest.osm.pbf
set -e
[ -f tunisia.osm.pbf ] || curl -L -o tunisia.osm.pbf https://download.geofabrik.de/africa/tunisia-latest.osm.pbf
IMG=ghcr.io/project-osrm/osrm-backend:v5.27.1
docker run --rm -v "$PWD:/data" $IMG osrm-extract -p /opt/car.lua /data/tunisia.osm.pbf
docker run --rm -v "$PWD:/data" $IMG osrm-partition /data/tunisia.osrm
docker run --rm -v "$PWD:/data" $IMG osrm-customize /data/tunisia.osrm
echo "Données prêtes. Démarrer le serveur : docker compose --profile routing up -d osrm"
