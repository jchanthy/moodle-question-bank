import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';

import { definePreset } from '@primeuix/themes';

const MyPreset = definePreset(Aura, {
    semantic: {
        primary: {
            50: '#eef9fe',
            100: '#d8f0fd',
            200: '#bde7fc',
            300: '#91d8fa',
            400: '#5ec4f6',
            500: '#3db5e6',
            600: '#2696cc',
            700: '#1f78a7',
            800: '#1b6388',
            900: '#195372',
            950: '#11354c'
        },
        colorScheme: {
            light: {
                success: {
                    color: '#76bd22'
                },
                info: {
                    color: '#3db5e6'
                },
                warn: {
                    color: '#ffc600'
                },
                error: {
                    color: '#ff4539'
                }
            }
        }
    }
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: MyPreset,
        options: {
          darkModeSelector: '.dark',
        }
      }
    })
  ]
};
