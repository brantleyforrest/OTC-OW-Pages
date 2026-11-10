// OUTLINE ONLY. This file contains no code yet. Replace each comment block with the code it describes.
//
// PURPOSE
// All physics for the Perturbations Explorer (orbits/perturbations.html). This file has no DOM and no
// Three.js, so every function can be run and checked in Node before any page exists.
//
// FORM
// Classic script, the same shape as frames/frame-math.js:
//     (function (root) { 'use strict'; ... root.PerturbationModel = { ...every function below... }; })(globalThis);
// Use globalThis so that the same file loads in a browser and in Node. Do not use ES modules, because
// browsers block external modules on pages opened from disk.
//
// UNITS
// Inside the model: km, seconds, radians, unless a name says otherwise (incDeg, tDays, and so on).
// Returned for display: rates in deg/day, accelerations in m/s^2. State the unit in each function's name
// or in a one-line comment.
//
// Every formula and every value in the check table at the bottom was confirmed on 2026-11-09 by a separate
// script. The J2 values match the lesson's worked examples. The drag, J2,2, and SRP models were also compared
// with direct numerical integration of the orbit. Do not change a formula to make a chart look better.


// ===========================================================================================
// 1. CONSTANTS
// ===========================================================================================
// Use the lesson's values, not the slightly different ones in sun-synchronous.js, so that the tool
// reproduces the lesson's worked examples to the printed digit.
//
//     MU = 398600.44             km^3/s^2
//     RE = 6378.14               km
//     J2 = 1.08263e-3
//     J22 = 1.8e-6
//     LON22 = -15                deg east, the long axis of the equator
//     R_GEO = 42164              km
//     MU_MOON = 4902.8           km^3/s^2       D_MOON = 384400        km
//     MU_SUN = 132712440018      km^3/s^2       D_SUN = 149597870      km
//     P_SUN = 4.54e-6            N/m^2 at 1 AU
//     CD = 2.2                   drag coefficient, matches the lesson's altitude figure
//     CR = 1.3                   reflectivity coefficient, matches the lesson's altitude figure
//     DAY_S = 86400              YEAR_DAYS = 365.25
//     GEO_TILT_PERIOD = 53       years
//     SUN_RATE = 2 * PI / (YEAR_DAYS * DAY_S)      rad/s
//     SSO_RATE = 0.9856          deg/day
//     CRITICAL_INC = [63.4349, 116.5651]           deg
//     STABLE_LON = [75, -105]    UNSTABLE_LON = [-15, 165]      deg east
//
// Export the constants too. The page uses them in its equation text.


// ===========================================================================================
// 2. GENERAL ORBIT HELPERS
// ===========================================================================================
// wrap180(deg), wrap360(deg)
// meanMotion(a) = sqrt(MU / a^3), rad/s
// periodSeconds(a) = 2 * PI / meanMotion(a)
// elementsFromAltitudes(hpKm, haKm) returns { a, e }:
//     a = RE + (hp + ha) / 2
//     e = (ha - hp) / (2 * RE + hp + ha)
// altitudesFromElements(a, e) returns { hp, ha }:
//     hp = a * (1 - e) - RE
//     ha = a * (1 + e) - RE
// radiusAt(a, e, nuRad) = a * (1 - e^2) / (1 + e * cos(nu))
// speedAt(a, r) = sqrt(MU * (2 / r - 1 / a))
// solveKepler(M, e): Newton's method on E - e * sin(E) = M. Start at E = M + e * sin(M), 8 iterations at most.
// trueFromEccentric(E, e) = 2 * atan2(sqrt(1 + e) * sin(E / 2), sqrt(1 - e) * cos(E / 2))


// ===========================================================================================
// 3. ATMOSPHERIC DRAG (lesson Section 1, SOB 1)
// ===========================================================================================
// DENSITY TABLE. Piecewise exponential mean atmosphere. Each row is [h0 km, rho0 kg/m^3, H km].
// This is the same data as the lesson's acceleration figure, which the check table confirms.
//     [0, 1.225, 7.249], [25, 3.899e-2, 6.349], [30, 1.774e-2, 6.682], [40, 3.972e-3, 7.554],
//     [50, 1.057e-3, 8.382], [60, 3.206e-4, 7.714], [70, 8.770e-5, 6.549], [80, 1.905e-5, 5.799],
//     [90, 3.396e-6, 5.382], [100, 5.297e-7, 5.877], [110, 9.661e-8, 7.263], [120, 2.438e-8, 9.473],
//     [130, 8.484e-9, 12.636], [140, 3.845e-9, 16.149], [150, 2.070e-9, 22.523], [180, 5.464e-10, 29.740],
//     [200, 2.789e-10, 37.105], [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628], [350, 9.518e-12, 53.298],
//     [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822], [600, 1.454e-13, 71.835],
//     [700, 3.614e-14, 88.667], [800, 1.170e-14, 124.64], [900, 5.245e-15, 181.05], [1000, 3.019e-15, 268.00]
//
// density(hKm): use the last row with h0 <= h, then rho = rho0 * exp(-(h - h0) / H). Rows above 1000 km use
// the last row. This is called hundreds of thousands of times per slider move, so use a plain loop.
//
// SOLAR = { min: 0.4, mean: 1.0, max: 2.5 }: multiplies density. Max / min = 6.25, inside the lesson's 3x to 10x.
// AREA = { feathered: 0.004, nominal: 0.01, windmill: 0.03 }: A/m in m^2/kg. BC = 1 / (CD * A/m), in kg/m^2.
//
// dragAccel(hKm, speedKmS, areaToMass, solarKey), m/s^2:
//     0.5 * density(h) * solarFactor * speed^2 * 1e6 * CD * areaToMass
//
// dragRates(a, e, B) returns { da, de } per second. B = CD * areaToMass * solarFactor, in m^2/kg.
// These are orbit averages. Do not integrate position, because a decay can span 100,000 revolutions.
// Integrate over eccentric anomaly with the midpoint rule, N = 360 points, Ek = 2 * PI * (k + 0.5) / N:
//     c = cos(Ek), h = a * (1 - e * c) - RE, d = density(h)
//     dARev = -(B * 1000) * a^2 * (2 * PI / N) * sum( d * (1 + e * c)^1.5 / sqrt(1 - e * c) )
//     dERev = -(B * 1000) * a * (1 - e^2) * (2 * PI / N) * sum( d * c * sqrt((1 + e * c) / (1 - e * c)) )
//     da = dARev / periodSeconds(a), de = dERev / periodSeconds(a)
// The factor of 1000 converts rho * B from 1/m to 1/km.
// Simplifications to keep: a spherical atmosphere that does not rotate, no day-night bulge, no J2 in this mode.
//
// decayHistory({ hp, ha, areaToMass, solar }) returns { samples, days, reentered }.
// samples is an array of { t: days, a, e }. Precompute the whole decay once per control change, because
// that gives the lifetime up front and lets the chart show the whole curve. It takes about 10 ms.
//     Start at elementsFromAltitudes(hp, ha), t = 0.
//     Loop with classic RK4 on (a, e):
//         k1 = rates(a, e)
//         dt = min(5 / abs(k1.da), capSeconds - t)      This limits each step to 5 km of change in a.
//         Compute k2, k3, k4, then advance.
//         Clamp e to >= 0. Set de = 0 whenever e <= 1e-5.
//         Stop when a * (1 - e) - RE <= 100 km, when t reaches 200 years, or after 20,000 steps.
//     reentered is true only if the 100 km condition ended the loop.
//
// sampleHistory(history, tDays): binary search, then linear interpolation of a and e.
// dragRegime(hp): 'immediate' for hp < 120, 'active' for 120 to 600, 'low' above 600.
// dragPhase(e): 1 for e > 0.05, otherwise 2. This is the lesson's table of decay phases.
// dragHeat(a, e, nuRad): log10(density(h) * speedAt(a, r)^2). The scene uses it to color the orbit.


// ===========================================================================================
// 4. J2 SECULAR DRIFT (lesson Section 2, SOB 2)
// ===========================================================================================
// j2Rates(a, e, incDeg) returns { p, n, nodeDegDay, perigeeDegDay }:
//     p = a * (1 - e^2)
//     n = meanMotion(a)
//     f = J2 * (RE / p)^2 * n
//     nodeDegDay = -1.5 * f * cos(i) * DAY_S * 180 / PI
//     perigeeDegDay = 0.75 * f * (5 * cos(i)^2 - 1) * DAY_S * 180 / PI
// Use this general form, not the lesson's rounded -9.9639 and 4.9820 forms.
// Treat abs(cos(i)) < 1e-9 as exactly zero, so that a polar orbit shows 0 and not -0.000.
//
// nodeDirection(incDeg): 'west' for i < 90, 'east' for i > 90, 'none' at i = 90.
// perigeeDirection(incDeg): 'forward' outside the critical band, 'backward' inside it, 'none' within
//     0.05 deg of a critical inclination.
// sunSyncInclination(a): acos(-SSO_RATE / (1.5 * J2 * (RE / a)^2 * n * DAY_S * 180 / PI)), in degrees. Circular orbit.
// apogeeLatitude(incDeg, argpDeg): asin(sin(i) * sin(argp + 180)), in degrees.


// ===========================================================================================
// 5. J2,2 LONGITUDE DRIFT AT GEO (lesson Section 2.6, SOB 3)
// ===========================================================================================
// All at r = R_GEO. Longitude is east-positive.
// K22 = 18 * MU * RE^2 * J22 / R_GEO^5, about 3.9424e-15 rad/s^2.
//
// tangentialAccel(lonDeg), m/s^2:
//     -6 * MU * RE^2 * J22 / R_GEO^4 * sin(2 * (lon - LON22)) * 1000
//     This is the lesson's a_lambda. It points toward the nearest end of the long axis.
// longitudeAccel(lonDeg), rad/s^2: K22 * sin(2 * (lon - LON22))
//     This equals -3 * a_lambda / r. It has the opposite sign to the tangential acceleration, which is the
//     counterintuitive point of this mode. The acceleration points toward the long axis. The drift goes away from it.
// driftPotential(lonDeg): cos(2 * (lon - LON22)), scaled from -1 to 1. Valleys at 75 E and 105 W, ridges at 15 W and 165 E.
//     The lesson stresses that this is a drift potential, not physical potential energy.
//
// stepLongitude(s, dtDays): velocity Verlet on s = { lon (rad, unwrapped), rate (rad/s) }.
//     Split dtDays into n = ceil(dtDays) equal substeps of at most 1 day.
//     Keep lon unwrapped during integration, and wrap only for display. A swing about 105 W crosses the date line.
//     Verlet conserves the swing amplitude. Euler does not, so do not substitute it.
//
// nearestStable(lonDeg): whichever of STABLE_LON is closest. amplitudeDeg = abs(wrap180(lon - stable)), at most 90.
// librationPeriodDays(amplitudeDeg):
//     T0 = 2 * PI / sqrt(2 * K22) / DAY_S, about 819 days
//     T = T0 * (2 / PI) * ellipticK(sin(amplitude)^2)
//     ellipticK(m) by the arithmetic-geometric mean: start a = 1, b = sqrt(1 - m), iterate a,b -> (a+b)/2, sqrt(a*b).
//     Result: PI / (2 * a). Return Infinity above 89.9 deg, and have the page print "Very long".
// semiMajorOffsetKm(rateRadS): -(2 * R_GEO / (3 * n)) * rate, with n = meanMotion(R_GEO).
//     Positive means above GEO. The satellite is above GEO while it drifts west.
// eastWestDvPerYear(lonDeg): 1.715 * abs(sin(2 * (lon - LON22))), in m/s/yr.
//     Use the printed 1.715. Integrating tangentialAccel over a year peaks at 1.749 with the lesson's rounded
//     J22, which would contradict the lesson's stated maximum of 1.715.


// ===========================================================================================
// 6. THIRD-BODY GRAVITY (lesson Section 3.1, SOB 3)
// ===========================================================================================
// thirdBodyAccel(mu3, bodyKm, satKm), returns [x, y, z] in m/s^2. Both positions are from Earth's center:
//     rel = sat - body
//     a = -mu3 * ( rel / |rel|^3 + body / |body|^3 ) * 1000
// Check: on the Earth-body line the result points outward. At 90 deg from the line it points inward.
//
// BODY_DIRECTION = [0, cos(23.44 deg), sin(23.44 deg)]. A single illustrative direction used for both bodies:
// the point of greatest northern declination. Do not add an ephemeris. The Moon would circle 40 times per second.
//
// geoTilt(tYears) returns { incDeg, nodeDeg }, for 0 <= t <= GEO_TILT_PERIOD:
//     incDeg = 15 * sin(PI * t / 53)
//     nodeDeg = 90 - 180 * t / 53
// This closed form matches the lesson's figures: an initial rate of 0.889 deg/yr, 15 deg near year 27, back to 0 at year 53.
//
// geoTiltRate(tYears): (15 * PI / 53) * cos(PI * t / 53), in deg/yr.
// figureEight(incDeg, count): for u from 0 to 360 deg, returns { lat, lonOffset } in degrees:
//     lat = asin(sin(i) * sin(u))
//     lonOffset = wrap180(atan2(cos(i) * sin(u), cos(u)) - u)
// NORTH_SOUTH_DV = { moon: 36.9, sun: 14.5, total: 51.4 }, m/s/yr, from the lesson's SMAD table.


// ===========================================================================================
// 7. SOLAR RADIATION PRESSURE (lesson Section 3.3, SOB 3)
// ===========================================================================================
// AREA_SRP = { dense: 0.01, arrays: 0.04, foil: 5 }, A/m in m^2/kg. "foil" is the lesson's high area-to-mass debris.
// srpAccel(areaToMass), m/s^2: P_SUN * CR * areaToMass.
// srpRadius(areaToMass): rE = 3 * (srpAccel / 1000) / (2 * V * SUN_RATE), with V = meanMotion(R_GEO) * R_GEO in km/s.
//     This is the small-eccentricity result for a circular orbit, ignoring eclipses.
// srpEccVector(tDays, areaToMass) returns { ex, ey, e, perigeeDeg }:
//     Sun longitude L = SUN_RATE * tDays * DAY_S, with L0 = 0 at t = 0
//     ex = rE * (cos(L) - 1), ey = rE * sin(L)
//     e = hypot(ex, ey), perigeeDeg = atan2(ey, ex)
//     Orbit starts circular at t = 0. e peaks at 2 * rE after half a year, and returns to 0 after one year.
// srpPerigeeDipKm(e): R_GEO * e.
// The "foil" case reaches e = 0.145, beyond strict small-e accuracy. Keep it as a teaching value.


// ===========================================================================================
// 8. PERTURBATION SIZE VERSUS ALTITUDE (lesson figure "perturbation_acceleration_vs_altitude")
// ===========================================================================================
// accelerationsAt(hKm) returns m/s^2, with r = RE + h. These are the lesson figure's own formulas:
//     central = MU / r^2 * 1000
//     j2 = 1.5 * J2 * MU * RE^2 / r^4 * 1000
//     j22 = 6 * MU * RE^2 * J22 / r^4 * 1000
//     moon = 2 * MU_MOON * r / D_MOON^3 * 1000
//     sun = 2 * MU_SUN * r / D_SUN^3 * 1000
//     thirdBody = moon + sun
//     srp = P_SUN * CR * 0.01
//     drag = dragAccel(h, sqrt(MU / r), 0.01, 'mean') for h <= 1000 km, otherwise null
//
// leadingPerturbation(hKm): the largest of j2, j22, thirdBody, srp, drag. Never central gravity.
// leadingNonGravitational(hKm): the larger of drag and srp.


// ===========================================================================================
// 9. CHECK TABLE. Every line must pass in Node before any page work begins.
// ===========================================================================================
// J2, matches the lesson's worked examples:
//     j2Rates(6878.14, 0, 45):           n = 1.10678e-3 rad/s, node = -5.410, perigee = +5.738, 360 / |node| = 66.54 days
//     j2Rates(26560, 0.745, 63.4349):    node = -0.1527, |perigee| < 1e-4, p = 11818.5
//     j2Rates(26560, 0.745, 55):         perigee = +0.1101, so 90 deg takes 817 days
//     sunSyncInclination(7078.14):       98.188 deg
//     j2Rates(6478.14, 0, 1):            node = -9.435 (lesson: "exceeding 9 deg/day at 100 km")
//
// Drag acceleration, nominal A/m, mean Sun. 8 + 0.8 * log10(a) reproduces the y coordinates in the lesson figure:
//     h = 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000
//     y = 5.015, 4.545, 4.161, 3.834, 3.506, 3.206, 2.918, 2.369, 1.880, 1.483, 1.200, 1.003
//
// decayHistory, nominal A/m, mean Sun unless stated:
//     250 x 1200 km: 241.57 days, 120 steps, reentered
//         at 25% of lifetime: hp 246.3, ha 1063.0, e 0.0581
//         at 50%:             hp 241.2, ha 907.1,  e 0.0479
//         at 75%:             hp 232.2, ha 704.2,  e 0.0345
//         at 90%:             hp 219.9, ha 524.0,  e 0.0225
//     250 x 1200, solar min: 603.92 days.     Solar max: 96.63 days.
//     250 x 1200, feathered: 603.92 days.     Windmill:  80.52 days.
//     Circular 200: 0.92 days.   400: 140.66 days.   500: 847.3 days.   600: 11.83 years.   800: 190.84 years.
//     (The lesson's "days to weeks" at 200 km is for a range of satellites. Nominal sits just under a day.)
//
// J2,2:
//     K22 = 3.9424e-15.   T0 = 819.0 days.
//     librationPeriodDays: amplitude 5 -> 821, 15 -> 833, 30 -> 879, 45 -> 967, 60 -> 1124, 75 -> 1443, 89 -> 2834
//     Start at 30 E at rest: moves east, turns at 120.0 E at about day 484.
//     Peak tangentialAccel: 5.54e-8 m/s^2.
//     Amplitude 45, at the well: drift 0.3108 deg/day, semi-major offset 24.20 km.
//
// accelerationsAt(35786): central 0.224, j2 8.33e-6, j22 5.54e-8, moon 7.28e-6, sun 3.34e-6, thirdBody 1.06e-5, srp 5.90e-8
// accelerationsAt(200):   central 9.21, j2 1.41e-2, j22 9.35e-5, moon 1.14e-6, sun 5.22e-7, srp 5.90e-8, drag 1.86e-4
// thirdBody first exceeds j2 at 33,787 km.   Drag falls below srp at 632 km.
//
// Third body at GEO, Moon on the +Y axis in the equatorial plane:
//     at [0, 42164, 0]: [0, +8.68e-6, 0].   At [42164, 0, 0]: [-3.57e-6, -5.90e-7, 0].
// geoTilt: rate at t = 0 is 0.889 deg/yr.   incDeg at t = 26.5 is 15.
//
// SRP, A/m = 0.01: accel 5.90e-8, rE = 1.4462e-4, peak e = 2.892e-4, perigee dip 12.2 km.
