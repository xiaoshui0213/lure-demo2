export type RestaurantLightSettings = {
  pendantRadius: number;
  pendantIntensity: number;
  pendantBloomStrength: number;
  pendantBloomBlur: number;
  pendantColor: string;
  doorRadius: number;
  doorIntensity: number;
  doorColor: string;
  neonRadius: number;
  neonIntensity: number;
  neonBloomStrength: number;
  neonBloomBlur: number;
  neonColor: string;
  tankRadius: number;
  tankIntensity: number;
  tankColor: string;
};

export const RESTAURANT_LIGHT_STORAGE_KEY = 'lure.restaurant-light-settings.v1';
export const RESTAURANT_LIGHT_SETTINGS_EVENT = 'lure:restaurant-light-settings';

export const DEFAULT_RESTAURANT_LIGHT_SETTINGS: RestaurantLightSettings = {
  pendantRadius: 15,
  pendantIntensity: 0.88,
  pendantBloomStrength: 0,
  pendantBloomBlur: 1.25,
  pendantColor: '#f4b878',
  doorRadius: 17,
  doorIntensity: 0.3,
  doorColor: '#f4b878',
  neonRadius: 39,
  neonIntensity: 0.48,
  neonBloomStrength: 0.5,
  neonBloomBlur: 1.35,
  neonColor: '#ff7a9c',
  tankRadius: 48,
  tankIntensity: 0.67,
  tankColor: '#6aa8c0',
};

export function loadRestaurantLightSettings(): RestaurantLightSettings {
  try {
    const raw = localStorage.getItem(RESTAURANT_LIGHT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RESTAURANT_LIGHT_SETTINGS };
    const saved = JSON.parse(raw) as Partial<RestaurantLightSettings>;
    return { ...DEFAULT_RESTAURANT_LIGHT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_RESTAURANT_LIGHT_SETTINGS };
  }
}

export function saveRestaurantLightSettings(settings: RestaurantLightSettings) {
  localStorage.setItem(RESTAURANT_LIGHT_STORAGE_KEY, JSON.stringify(settings));
}

export function dispatchRestaurantLightSettings(settings: RestaurantLightSettings) {
  window.dispatchEvent(new CustomEvent<RestaurantLightSettings>(
    RESTAURANT_LIGHT_SETTINGS_EVENT,
    { detail: { ...settings } },
  ));
}
