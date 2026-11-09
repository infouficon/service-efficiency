import { BatteryCharging, Box, Cable, Headphones, Laptop, MapPin, Smartphone, Speaker, Tablet, Tv, Watch } from 'lucide-react';

/**
 * The icon of a product category (D72), the same on every screen. D112 adds the devices that left the accessories: AirPods,
 * Apple TV, HomePod and AirTag. A category without its own icon (another brand, a new warroom group) gets a box.
 */
export function CategoryIcon({ category, size = 16 }: { category: string; size?: number }) {
  switch (category) {
    case 'iPhone':
      return <Smartphone size={size} />;
    case 'iPad':
      return <Tablet size={size} />;
    case 'Mac':
      return <Laptop size={size} />;
    case 'Watch':
      return <Watch size={size} />;
    case 'AirPods':
      return <Headphones size={size} />;
    case 'Apple TV':
      return <Tv size={size} />;
    case 'HomePod':
      return <Speaker size={size} />;
    case 'AirTag':
      return <MapPin size={size} />;
    case 'Accessories':
      return <Cable size={size} />;
    case 'Battery':
      return <BatteryCharging size={size} />;
    default:
      return <Box size={size} />;
  }
}
