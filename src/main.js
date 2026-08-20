import './style.css';
import './aurora-skin.css';
import './aurora-skin.js';
import { createApp } from './app.js';

const appEl = document.getElementById('app');
if (appEl) createApp(appEl);
