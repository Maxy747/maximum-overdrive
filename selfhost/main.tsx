import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '../app/auth';
import '../app/globals.css';
import {registerServiceWorker} from '../app/notifications';
createRoot(document.getElementById('root')!).render(<App/>);
registerServiceWorker();
