/**
 * Generated On: 2016-09-28
 * Class: FeatureToolBox
 * Description:
 */
import Coordinates from '../../Core/Geographic/Coordinates';
import Extent from '../../Core/Geographic/Extent';

function readCRS(json) {
    if (json.crs) {
        if (json.crs.type.toLowerCase() == 'epsg') {
            return `EPSG:${json.crs.properties.code}`;
        } else if (json.crs.type.toLowerCase() == 'name') {
            const epsgIdx = json.crs.properties.name.toLowerCase().indexOf('epsg:');
            if (epsgIdx >= 0) {
                // authority:version:code => EPSG:[...]:code
                const codeStart = json.crs.properties.name.indexOf(':', epsgIdx + 5);
                if (codeStart > 0) {
                    return `EPSG:${json.crs.properties.name.substr(codeStart + 1)}`;
                }
            }
        }
        throw new Error(`Unsupported CRS type '${json.crs}'`);
    }
    // assume default crs
    return 'EPSG:4326';
}

const coords = new Coordinates('EPSG:4978', 0, 0, 0);
function readCoordinates(crsIn, crsOut, coordinates, extent) {
    // coordinates is a list of pair [[x1, y1], [x2, y2], ..., [xn, yn]]
    const out = new Array(coordinates.length);
    let i = 0;
    for (const pair of coordinates) {
        // TODO: 1 is a default z value, makes this configurable
        if (crsIn === crsOut) {
            out[i] = new Coordinates(crsIn, pair[0], pair[1], 1);
        } else {
            coords.set(crsIn, pair[0], pair[1], 1);
            out[i] = coords.as(crsOut);
        }
        // expand extent if present
        if (extent) {
            extent.expandByPoint(out[i]);
        }
        ++i;
    }
    return out;
}

// Helper struct that returns an object { type: "", coordinates: [...], extent}:
// - type is the geom type
// - Coordinates is an array of Coordinate
// - extent is optional, it's coordinates's extent
// Multi-* geometry types are merged in one.
const GeometryToCoordinates = {
    point(crsIn, crsOut, coordsIn, filteringExtent, options) {
        const extent = options.buildExtent ? new Extent(crsOut, Infinity, -Infinity, Infinity, -Infinity) : undefined;
        let coordinates = readCoordinates(crsIn, crsOut, coordsIn, extent);
        if (filteringExtent) {
            coordinates = coordinates.filter(c => filteringExtent.isPointInside(c));
        }
        return { type: 'point', coordinates, extent };
    },
    // TODO support holes
    polygon(crsIn, crsOut, coordsIn, filteringExtent, options) {
        const extent = options.buildExtent ? new Extent(crsOut, Infinity, -Infinity, Infinity, -Infinity) : undefined;
        const coordinates = readCoordinates(crsIn, crsOut, coordsIn, extent);
        if (filteringExtent && !filteringExtent.isPointInside(coordinates[0])) {
            return;
        }
        return { type: 'polygon', coordinates, extent };
    },
    lineString(crsIn, crsOut, coordsIn, filteringExtent, options) {
        const extent = options.buildExtent ? new Extent(crsOut, Infinity, -Infinity, Infinity, -Infinity) : undefined;
        const coordinates = readCoordinates(crsIn, crsOut, coordsIn, extent);
        if (filteringExtent && !filteringExtent.isPointInside(coordinates[0])) {
            return;
        }
        return { type: 'linestring', coordinates, extent };
    },
    merge(...geoms) {
        let result;
        let offset = 0;
        for (const geom of geoms) {
            if (!geom) {
                continue;
            }
            if (!result) {
                result = geom;
                // instance extent if present
                if (geom.extent) {
                    result.extent = geom.extent.clone();
                }
                result.featureVertices = {};
            } else {
                // merge coordinates
                for (const coordinate of geom.coordinates) {
                    result.coordinates.push(coordinate);
                }
                // union extent if present
                if (geom.extent) {
                    result.extent.union(geom.extent);
                }
            }
            result.featureVertices[geom.featureIndex || 0] = { offset, count: geom.coordinates.length, extent: geom.extent };
            offset = result.coordinates.length;
        }
        return result;
    },
    multiLineString(crsIn, crsOut, coordsIn, filteringExtent, options) {
        let result;
        for (const line of coordsIn) {
            const l = this.lineString(crsIn, crsOut, line, filteringExtent, options);
            if (!l) {
                return;
            }
            // only test the first line
            filteringExtent = undefined;
            result = this.merge(result, l);
        }
        return result;
    },
    multiPolygon(crsIn, crsOut, coordsIn, filteringExtent, options) {
        let result;
        for (const polygon of coordsIn) {
            const p = this.polygon(crsIn, crsOut, polygon[0], filteringExtent, options);
            if (!p) {
                return;
            }
            // only test the first poly
            filteringExtent = undefined;
            result = this.merge(result, p);
        }
        return result;
    },
};

function readGeometry(crsIn, crsOut, json, filteringExtent, options) {
    if (json.coordinates.length == 0) {
        return;
    }
    switch (json.type.toLowerCase()) {
        case 'point':
            return GeometryToCoordinates.point(crsIn, crsOut, [json.coordinates], filteringExtent, options);
        case 'multipoint':
            return GeometryToCoordinates.point(crsIn, crsOut, json.coordinates, filteringExtent, options);
        case 'linestring':
            return GeometryToCoordinates.lineString(crsIn, crsOut, json.coordinates, filteringExtent, options);
        case 'multilinestring':
            return GeometryToCoordinates.multiLineString(crsIn, crsOut, json.coordinates, filteringExtent, options);
        case 'polygon':
            return GeometryToCoordinates.polygon(crsIn, crsOut, json.coordinates[0], filteringExtent, options);
        case 'multipolygon':
            return GeometryToCoordinates.multiPolygon(crsIn, crsOut, json.coordinates, filteringExtent, options);
        case 'geometrycollection':
        default:
            throw new Error(`Unhandled geometry type ${json.type}`);
    }
}

function readFeature(crsIn, crsOut, json, filteringExtent, options) {
    if (options.filter && !options.filter(json.properties)) {
        return;
    }
    const feature = {};
    feature.geometry = readGeometry(crsIn, crsOut, json.geometry, filteringExtent, options);

    if (!feature.geometry) {
        return;
    }
    feature.properties = json.properties || {};
    // copy other properties
    for (const key of Object.keys(json)) {
        if (['type', 'geometry', 'properties'].indexOf(key.toLowerCase()) < 0) {
            feature.properties[key] = json[key];
        }
    }

    return feature;
}

export default {
    parse(crsOut, json, filteringExtent, options = {}) {
        options.crsIn = options.crsIn || readCRS(json);
        switch (json.type.toLowerCase()) {
            case 'featurecollection':
                return json.features.map(f => readFeature(options.crsIn, crsOut, f, filteringExtent, options));
            case 'feature':
                return readFeature(options.crsIn, crsOut, json, filteringExtent, options);
            default:
                throw new Error(`Unsupported GeoJSON type: '${json.type}`);
        }
    },
};
