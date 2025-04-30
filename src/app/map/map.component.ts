import { AfterViewInit, Component, OnDestroy, OnInit } from '@angular/core';
import mapboxgl from 'mapbox-gl';

@Component({
  selector: 'app-map',
  imports: [],
  templateUrl: './map.component.html',
  styleUrl: './map.component.css'
})
export class MapComponent implements OnInit, AfterViewInit, OnDestroy {
  map: mapboxgl.Map | undefined;
  trackCoordinates: number[][] = [];
  animationFrameId: number | null = null;
  currentPointIndex = 0;
  movingMarker: mapboxgl.Marker | null = null;
  animationSpeedFactor = 1;
  currentMapBearing = 0;
  isRunButtonDisabled = true;
  isStopButtonDisabled = true;
  runButtonText = 'Run Simulation';

  constructor() {
      (mapboxgl as any).accessToken = 'VOTRE_CLE_MAPBOX'; // Remplacez par votre clé
  }

  ngOnInit(): void {}

  ngAfterViewInit(): void {
      this.initializeMap();
  }

  ngOnDestroy(): void {
      if (this.animationFrameId) {
          cancelAnimationFrame(this.animationFrameId);
      }
      if (this.movingMarker) {
          this.movingMarker.remove();
      }
      if (this.map) {
          this.map.remove();
      }
  }

  initializeMap(): void {
      this.map = new mapboxgl.Map({
          container: 'map',
          style: 'mapbox://styles/mapbox/satellite-streets-v12',
          center: [2, 46],
          zoom: 5,
          pitch: 45,
          bearing: 0
      });

      this.map.addControl(new mapboxgl.NavigationControl());

      this.map.on('load', () => {
          this.loadAndDisplayGPX('');
      });

      this.map.on('error', (e) => console.error('Mapbox error:', e));
  }

  calculateBearing(startCoord: number[], endCoord: number[]): number {
      const lon1 = (startCoord[0] * Math.PI) / 180,
          lat1 = (startCoord[1] * Math.PI) / 180;
      const lon2 = (endCoord[0] * Math.PI) / 180,
          lat2 = (endCoord[1] * Math.PI) / 180;
      const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
      const x =
          Math.cos(lat1) * Math.sin(lat2) -
          Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
      let brng = (Math.atan2(y, x) * 180) / Math.PI;
      return (brng + 360) % 360;
  }

  shortestAngleDiff(a1: number, a2: number): number {
      let diff = a2 - a1;
      while (diff <= -180) diff += 360;
      while (diff > 180) diff -= 360;
      return diff;
  }

  lerp(start: number, end: number, amount: number): number {
      return start + amount * (end - start);
  }

 animateTrack(): void {
    if (!this.map) return;

    const safeIndex = Math.min(this.currentPointIndex, this.trackCoordinates.length - 1);

    if (safeIndex >= this.trackCoordinates.length - 1) {
        console.log('Animation terminée.');
        this.updateProgressLine(this.trackCoordinates);
        this.stopAnimation();
        return;
    }

    const startPoint: [number, number] = this.trackCoordinates[safeIndex];
    const endPoint: [number, number] = this.trackCoordinates[safeIndex + 1];

    let targetBearing = this.calculateBearing(startPoint, endPoint);
    if (
        Math.abs(startPoint[0] - endPoint[0]) < 0.00005 &&
        Math.abs(startPoint[1] - endPoint[1]) < 0.00005 &&
        safeIndex < this.trackCoordinates.length - 5
    ) {
        const furtherPoint = this.trackCoordinates[safeIndex + 5];
        targetBearing = this.calculateBearing(startPoint, furtherPoint);
    }
    const angleDifference = this.shortestAngleDiff(this.currentMapBearing, targetBearing);
    const smoothedBearing = this.currentMapBearing + angleDifference * 0.1;
    this.currentMapBearing = smoothedBearing;

    if (!this.movingMarker) {
        const markerElement = document.createElement('div');
        markerElement.className = 'moving-marker';
        this.movingMarker = new mapboxgl.Marker(markerElement)
            .setLngLat(startPoint)
            .addTo(this.map);
    } else {
        this.movingMarker.setLngLat(startPoint);
    }

    const progressCoordinates = this.trackCoordinates.slice(0, safeIndex + 1);
    this.updateProgressLine(progressCoordinates);

    this.map.easeTo({
        center: startPoint as [number, number], // Typage explicite pour éviter l'erreur
        zoom: 14,
        pitch: 65,
        bearing: this.currentMapBearing,
        duration: 500,
        easing: (t) => t
    });

    this.currentPointIndex += this.animationSpeedFactor;
    this.animationFrameId = requestAnimationFrame(() => this.animateTrack());
}
  updateProgressLine(coordinates: number[][]): void {
      if (!this.map) return;
      const progressSource = this.map.getSource('route-progress-source') as mapboxgl.GeoJSONSource;
      if (progressSource && coordinates && coordinates.length > 0) {
          progressSource.setData({
              type: 'Feature',
              properties: {},
              geometry: {
                  type: 'LineString',
                  coordinates: coordinates
              }
          });
      } else if (progressSource) {
          progressSource.setData({
              type: 'Feature',
              properties: {},
              geometry: {
                  type: 'LineString',
                  coordinates: []
              }
          });
      }
  }

  stopAnimation(): void {
      if (this.animationFrameId) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
      }
      this.isRunButtonDisabled = false;
      this.isStopButtonDisabled = true;
      this.runButtonText = 'Run Simulation';
      console.log('Animation arrêtée.');
  }

  async loadAndDisplayGPX(gpxFilePath: string): Promise<void> {
      try {
          const response = await fetch(gpxFilePath);
          if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
          const gpxText = await response.text();
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(gpxText, 'text/xml');
          let points: Element[];
          let getCoordinates: (p: Element) => number[];
          const trackpoints = xmlDoc.getElementsByTagName('trkpt');
          const routepoints = xmlDoc.getElementsByTagName('rtept');
          if (trackpoints.length > 0) {
              points = Array.from(trackpoints);
              getCoordinates = (p) => [
                  parseFloat(p.getAttribute('lon')!),
                  parseFloat(p.getAttribute('lat')!)
              ];
          } else if (routepoints.length > 0) {
              points = Array.from(routepoints);
              getCoordinates = (p) => [
                  parseFloat(p.getAttribute('lon')!),
                  parseFloat(p.getAttribute('lat')!)
              ];
          } else {
              throw new Error('No <trkpt> or <rtept> points found.');
          }
          this.trackCoordinates = points.map(getCoordinates);
          if (this.trackCoordinates.length < 2) throw new Error('Not enough coordinates.');

          if (!this.map) return;

          this.map.addSource('route-progress-source', {
              type: 'geojson',
              data: {
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'LineString', coordinates: [] }
              }
          });

          this.map.addLayer({
              id: 'route-progress-line',
              type: 'line',
              source: 'route-progress-source',
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                  'line-color': '#e63946',
                  'line-width': 4,
                  'line-opacity': 0.9
              }
          });

          this.map.addSource('route-full-source', {
              type: 'geojson',
              data: {
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'LineString', coordinates: this.trackCoordinates }
              }
          });

          this.map.addLayer(
              {
                  id: 'route-full-line-background',
                  type: 'line',
                  source: 'route-full-source',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: {
                      'line-color': '#ffffff',
                      'line-width': 2,
                      'line-opacity': 0.2,
                      'line-dasharray': [2, 2]
                  }
              },
              'route-progress-line'
          );

          const bounds = this.trackCoordinates.reduce(
              (bounds, coord) => bounds.extend(coord),
              new mapboxgl.LngLatBounds(this.trackCoordinates[0], this.trackCoordinates[0])
          );
          this.map.fitBounds(bounds, {
              padding: { top: 80, bottom: 40, left: 40, right: 40 }
          });

          this.isRunButtonDisabled = false;
          this.isStopButtonDisabled = true;

          this.map.addSource('mapbox-dem', {
              type: 'raster-dem',
              url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
              tileSize: 512,
              maxzoom: 14
          });
          this.map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
          this.map.addLayer({
              id: 'sky',
              type: 'sky',
              paint: {
                  'sky-type': 'atmosphere',
                  'sky-atmosphere-sun': [0.0, 0.0],
                  'sky-atmosphere-sun-intensity': 15
              }
          });
      } catch (error) {
          console.error('Error loading/displaying GPX:', error);
          alert('Failed to load GPX track. Check console.');
          this.isRunButtonDisabled = true;
          this.isStopButtonDisabled = true;
      }
  }

  runSimulation(): void {
      if (!this.animationFrameId && this.trackCoordinates.length > 1) {
          this.currentPointIndex = 0;
          this.currentMapBearing = this.map?.getBearing() || 0;
          this.isRunButtonDisabled = true;
          this.isStopButtonDisabled = false;
          this.runButtonText = 'Running...';

          this.updateProgressLine([this.trackCoordinates[0]]);

          if (this.movingMarker) {
              this.movingMarker.remove();
              this.movingMarker = null;
          }
          this.animateTrack();
      } else if (this.trackCoordinates.length <= 1) {
          alert("La trace n'a pas été chargée ou est trop courte.");
      }
  }

  stopSimulation(): void {
      this.stopAnimation();
  }
}
