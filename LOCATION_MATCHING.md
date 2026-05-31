# Location-based Matching Feature

## Overview
The MM Match bot now supports location-based matching with distance filtering, allowing users to find matches within their preferred geographic radius.

## How It Works
The bot uses the Haversine formula to calculate the distance between users' coordinates and filters matches based on your preferred distance radius.

## Technical Implementation

### Distance Calculation
- **Haversine Formula**: Calculates the great-circle distance between two points on a sphere given their longitudes and latitudes
- **Bounding Box Approximation**: Uses SQL to filter profiles within a geographic bounding box for performance optimization
- **Precise Distance Filtering**: Applies Haversine formula in JavaScript for accurate distance calculation after SQL filtering
- **Fallback Logic**: If no profiles found within distance, falls back to broader search

### Database Schema Changes
New fields added to the `users` table:
- `latitude REAL` - User's location latitude
- `longitude REAL` - User's location longitude  
- `max_distance_km INTEGER DEFAULT 50` - Maximum distance for matches in km

### Distance Options
Users can choose from the following distance preferences:
- **10 km** - Very local matches
- **25 km** - City-wide matches
- **50 km** - Regional matches (default)
- **100 km** - Extended regional matches
- **Any** - No distance restriction (9999 km)

## User Experience

### Registration Flow
1. **Nickname** - Type your display name
2. **Age** - Enter your age (numbers only)
3. **Address** - Enter your city/location OR send your live location via Telegram
4. **Photo** - Upload a profile photo
5. **Bio** - Write a short description about yourself
6. **Gender** - Select Male or Female (button-based)
7. **Looking For** - Select which gender you want to see
8. **Distance Radius** - Set your preferred search distance

### Location Sharing
- Users can share their live or static Telegram location during registration
- Location sharing is optional - users can enter city name instead
- Location data is stored securely in the database

### Profile Discovery
- Profiles are filtered based on the user's distance preference
- Only shows profiles within the specified radius (if location is shared)
- Falls back to broader search if no local matches found

## Privacy Considerations
- Location sharing is completely optional
- Users can choose to enter city name instead of sharing coordinates
- Location data is stored securely in the database
- Distance filtering helps users find nearby matches while maintaining privacy

## Migration
To add location-based matching to an existing database, run the migration script:

```bash
# Apply location migration
turso db shell your-db-name < location-migration.sql
```

This will add the necessary fields and indexes to support location-based matching.
