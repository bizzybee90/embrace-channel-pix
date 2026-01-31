
# Fix: Distance-Based Competitor Sorting

## The Problem

Your competitor list shows Bedford businesses instead of Luton ones because:

1. **Apify returns results in Google's ranking order** - not by distance
2. **Google prioritizes ratings/reviews** over proximity in its search results
3. **We never calculate or sort by distance** even though we have coordinates

From the database, there are literally **zero businesses with "Luton" in their address** despite Luton being the target location.

## The Solution

We need a **two-part fix**:

### Part 1: Calculate Distance During Discovery

When the Apify webhook returns results, we need to:
- Extract each business's lat/lng from the `location` field
- Calculate distance from job's geocoded center using Haversine formula
- Store distance in `competitor_sites.distance_miles`

### Part 2: Sort by Distance + Show in UI

- Sort results by distance (closest first) before inserting
- Display distance in the review UI
- Limit to the closest N competitors that meet the target count

## Technical Changes

### File 1: `supabase/functions/handle-discovery-complete/index.ts`

Add distance calculation using job's geocoded coordinates:

```text
Current flow:
1. Fetch places from Apify
2. Filter out directories/social media  
3. Insert to database (unsorted)

New flow:
1. Fetch places from Apify
2. Filter out directories/social media
3. For each place with location.lat/lng:
   - Calculate distance from job's geocoded_lat/lng
   - Store in distance_miles field
4. Sort by distance (closest first)
5. Insert to database in sorted order
```

Key code addition:
```
// Haversine formula for distance calculation
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// For each place, calculate distance from center
const jobLat = job.geocoded_lat;
const jobLng = job.geocoded_lng;

for (const place of places) {
  if (place.location?.lat && place.location?.lng) {
    distance_miles = haversineDistance(jobLat, jobLng, place.location.lat, place.location.lng);
  }
}

// Sort by distance before inserting
validCompetitors.sort((a, b) => (a.distance_miles || 999) - (b.distance_miles || 999));
```

### File 2: Add `distance_miles` Column

Database migration to add the column if not present:
```sql
ALTER TABLE competitor_sites 
ADD COLUMN IF NOT EXISTS distance_miles DECIMAL(5,1);
```

### File 3: `src/components/onboarding/CompetitorReviewScreen.tsx`

Update the competitor row display to:
- Show distance badge ("2.3 mi")
- Sort by distance by default
- Add action buttons (External Link, Delete) that were missing

```text
<div className="flex items-center gap-3 p-3">
  <Checkbox ... />
  <div className="flex-1">
    <span>{business_name}</span>
    {distance_miles && (
      <Badge variant="outline">{distance_miles} mi</Badge>
    )}
    <span className="text-muted-foreground">{domain}</span>
  </div>
  <div className="flex gap-1">
    <Button variant="ghost" size="icon" asChild>
      <a href={url} target="_blank"><ExternalLink /></a>
    </Button>
    <Button variant="ghost" size="icon" onClick={handleDelete}>
      <X />
    </Button>
  </div>
</div>
```

### File 4: `supabase/functions/start-competitor-research/index.ts`

Increase the request count to get more results before distance filtering:
```
// Request 3x target to account for:
// - ~40% filtering loss (no website, directories, social)
// - Distance-based trimming (some might be too far)
const crawlLimit = Math.min(maxCompetitors * 3, 300);
```

## Expected Outcome

After these changes:
1. A search for "Window Cleaning in Luton" will show Luton businesses first
2. Bedford businesses will still appear but further down the list
3. Users can see how far each competitor is from their target area
4. The "0 valid websites" display bug will be fixed
5. Delete and external link buttons will be restored

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/handle-discovery-complete/index.ts` | Add distance calculation and sorting |
| `supabase/functions/start-competitor-research/index.ts` | Increase crawl limit to 3x |
| `src/components/onboarding/CompetitorReviewScreen.tsx` | Add distance display, delete/link buttons |
| Database migration | Add `distance_miles` column |
