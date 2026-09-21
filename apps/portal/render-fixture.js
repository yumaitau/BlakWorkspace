'use strict';

const { APPS } = require('./catalog');
const { shell, signinPage, navGroups } = require('./server');

const user = { name: 'Ada Example', sub: 'ada', email: 'ada@example.test', apps: APPS.map(a => a.id) };
const html = shell(user, 'home', 'Home', '<div class=grid id=home-cards data-testid="home-cards"></div>');
process.stdout.write(JSON.stringify({
  html,
  signin: signinPage(),
  apps: APPS,
  nav: navGroups('home', user),
}));
