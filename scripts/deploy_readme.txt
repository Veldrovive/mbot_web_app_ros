# MBot Web App Release

To install the web app, first unpack this file with:

  tar -xvzf mbot_web_app-[VERSION].tar.gz
  cd mbot_web_app-[VERSION]

Then install the dependencies and deploy:

  ./install_nginx.sh
  ./deploy_app.sh --no-rebuild
