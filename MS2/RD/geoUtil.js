define(['esri/geometry/webMercatorUtils'], function (webMercatorUtils) {

  /**
   * A set of helpful functions to streamline geospatial operations
   * @namespace geoUtil
   * @type {{}}
   */
  var geoUtil = {};

  /**
   * Move a geometry by a distance and angle
   * @param {Geometry} geometry - The geometry to move
   * @param {Number} distance - The distance to move the geometry in meters
   * @param {Number} angle - The angle to move the geometry by
   * @returns {*}
   */
  /**
   * Created by t953468 on 2/8/2017.
   */
  geoUtil.moveGeometry = function (geometry, distance, angle) {
    var isWebMercator = geometry.spatialReference.isWebMercator();
    var geometry = isWebMercator ? geometry : webMercatorUtils.geographicToWebMercator(geometry);
    var newGeometry;
    switch (geometry.type) {
      case "point":
        newGeometry = this._movePoint(geometry, distance, angle);
        break;
      case "polyline":
        newGeometry = this._movePolygon(geometry, geometry.paths, distance, angle);
        break;
      case "polygon":
        newGeometry = this._movePolygon(geometry, geometry.rings, distance, angle);
        break;
    }
    return isWebMercator ? newGeometry : webMercatorUtils.webMercatorToGeographic(newGeometry);
  };

  /**
   * Move a point geometry by a distance and angle
   * @param {Point} point - The Point geometry to move
   * @param {Number} distance - The distance to move the geometry in meters
   * @param {Number} angle - The angle to move the geometry by
   * @returns {Point}
   * @private
   */
  geoUtil._movePoint = function (point, distance, angle) {
    var radians = angle * (Math.PI / 180); // Convert angle to radians
    var newX = point.x + distance * Math.cos(radians); // calc new X
    var newY = point.y + distance * Math.sin(radians); // calc new Y
    var deltaX = newX - point.x;
    var deltaY = newY - point.y;
    return point.offset(deltaX, deltaY);
  };

  /**
   * Move a polygon geometry by a distance and angle
   * @param {Polygon} polygon - The Polygon geometry to move
   * @param {Number[][][]} Rings An array of rings
   * @param {Number} distance - The distance to move the geometry in meters
   * @param {Number} angle - The angle to move the geometry by
   * @returns {Polygon}
   * @private
   */
  geoUtil._movePolygon = function (geometry, rings, distance, angle) {
    for (var ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      var ring = rings[ringIndex];
      for (var pointIndex = 0; pointIndex < ring.length; pointIndex++) {
        var ringPoint = geometry.getPoint(ringIndex, pointIndex);
        geometry.setPoint(ringIndex, pointIndex, this._movePoint(ringPoint, distance, angle));
      }
    }
    return geometry;
  };

  return geoUtil;
});
