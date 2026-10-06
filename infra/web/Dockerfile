# Sert une app Flutter web compilée (dossier `site/`, copie de build/web) sur Cloud Run, avec repli vers index.html.
#   voir infra/web/deploy.ps1
FROM nginx:1.27-alpine
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY site /usr/share/nginx/html
# Cloud Run fournit PORT ; l'image nginx remplace ${PORT} dans le modèle au démarrage
ENV PORT=8080
