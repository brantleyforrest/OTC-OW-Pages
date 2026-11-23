// solvers.js
// The solver setting's four choices for Cowell's method: each Runge-Kutta method's Butcher
// tableau, with its source. The one stepper that runs them all is in cowell.js beside this file.
// Each tableau is checked when this file loads.
// No DOM. Load after the constant files (it adds SOLVERS to window.OrbitConstants).
(function (global) {
    'use strict';

    const OC = global.OrbitConstants;
    if (!OC) throw new Error('solvers.js: load math/constants/shared.js first');

    /* 7. Solver tableaus for Cowell's method -------------------------------- */
    // c: stage times; a[i][j]: stage weights; b: kept solution; bHat: embedded estimate (none = fixed step);
    // fsal: last stage equals the next step's first.
    const SOLVERS = {
        PD78: {
            name: 'Prince–Dormand 8(7)',
            source: 'Prince & Dormand (1981), RK8(7)13M; GMAT PrinceDormand78',
            order: 8, errOrder: 7, fsal: false,
            c: [0, 1 / 18, 1 / 12, 1 / 8, 5 / 16, 3 / 8, 59 / 400, 93 / 200,
                5490023248 / 9719169821, 13 / 20, 1201146811 / 1299019798, 1, 1],
            a: [
                [],
                [1 / 18],
                [1 / 48, 1 / 16],
                [1 / 32, 0, 3 / 32],
                [5 / 16, 0, -75 / 64, 75 / 64],
                [3 / 80, 0, 0, 3 / 16, 3 / 20],
                [29443841 / 614563906, 0, 0, 77736538 / 692538347, -28693883 / 1125000000,
                    23124283 / 1800000000],
                [16016141 / 946692911, 0, 0, 61564180 / 158732637, 22789713 / 633445777,
                    545815736 / 2771057229, -180193667 / 1043307555],
                [39632708 / 573591083, 0, 0, -433636366 / 683701615, -421739975 / 2616292301,
                    100302831 / 723423059, 790204164 / 839813087, 800635310 / 3783071287],
                [246121993 / 1340847787, 0, 0, -37695042795 / 15268766246, -309121744 / 1061227803,
                    -12992083 / 490766935, 6005943493 / 2108947869, 393006217 / 1396673457,
                    123872331 / 1001029789],
                [-1028468189 / 846180014, 0, 0, 8478235783 / 508512852, 1311729495 / 1432422823,
                    -10304129995 / 1701304382, -48777925059 / 3047939560, 15336726248 / 1032824649,
                    -45442868181 / 3398467696, 3065993473 / 597172653],
                [185892177 / 718116043, 0, 0, -3185094517 / 667107341, -477755414 / 1098053517,
                    -703635378 / 230739211, 5731566787 / 1027545527, 5232866602 / 850066563,
                    -4093664535 / 808688257, 3962137247 / 1805957418, 65686358 / 487910083],
                [403863854 / 491063109, 0, 0, -5068492393 / 434740067, -411421997 / 543043805,
                    652783627 / 914296604, 11173962825 / 925320556, -13158990841 / 6184727034,
                    3936647629 / 1978049680, -160528059 / 685178525, 248638103 / 1413531060, 0]
            ],
            b: [14005451 / 335480064, 0, 0, 0, 0, -59238493 / 1068277825, 181606767 / 758867731,
                561292985 / 797845732, -1041891430 / 1371343529, 760417239 / 1151165299,
                118820643 / 751138087, -528747749 / 2220607170, 1 / 4],
            bHat: [13451932 / 455176623, 0, 0, 0, 0, -808719846 / 976000145, 1757004468 / 5645159321,
                656045339 / 265891186, -3867574721 / 1518517206, 465885868 / 322736535,
                53011238 / 667516719, 2 / 45, 0]
        },
        DP45: {
            name: 'Prince–Dormand 4(5)',
            source: 'Dormand & Prince (1980), RK5(4)7M; MATLAB ode45; GMAT PrinceDormand45',
            order: 5, errOrder: 4, fsal: true,
            c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
            a: [
                [],
                [1 / 5],
                [3 / 40, 9 / 40],
                [44 / 45, -56 / 15, 32 / 9],
                [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
                [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
                [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]
            ],
            b: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
            bHat: [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40]
        },
        RKF45: {
            name: 'Runge–Kutta–Fehlberg 4(5)',
            source: 'Fehlberg (1969), NASA TR R-315; the 5th-order solution is kept',
            order: 5, errOrder: 4, fsal: false,
            c: [0, 1 / 4, 3 / 8, 12 / 13, 1, 1 / 2],
            a: [
                [],
                [1 / 4],
                [3 / 32, 9 / 32],
                [1932 / 2197, -7200 / 2197, 7296 / 2197],
                [439 / 216, -8, 3680 / 513, -845 / 4104],
                [-8 / 27, 2, -3544 / 2565, 1859 / 4104, -11 / 40]
            ],
            b: [16 / 135, 0, 6656 / 12825, 28561 / 56430, -9 / 50, 2 / 55],
            bHat: [25 / 216, 0, 1408 / 2565, 2197 / 4104, -1 / 5, 0]
        },
        RK4: {
            name: 'Runge–Kutta 4 (fixed step)',
            source: 'Classic fourth-order Runge–Kutta; no error estimate, so the step is fixed',
            order: 4, errOrder: null, fsal: false,
            c: [0, 1 / 2, 1 / 2, 1],
            a: [[], [1 / 2], [0, 1 / 2], [0, 0, 1]],
            b: [1 / 6, 1 / 3, 1 / 3, 1 / 6]
        }
    };
    const SOLVER_IDS = ['PD78', 'DP45', 'RKF45', 'RK4'];

    // Problems with a tableau; empty when consistent (rows of a sum to c; b and bHat sum to 1).
    function validateTableau(t) {
        const problems = [];
        const sum = (row) => row.reduce((s, x) => s + x, 0);
        const close = (x, y) => Math.abs(x - y) <= 1e-13;
        const s = t.c.length;
        if (t.a.length !== s || t.b.length !== s || (t.bHat && t.bHat.length !== s)) problems.push('lengths of c, a, b, bHat differ');
        t.a.forEach((row, i) => {
            if (row.length !== i) problems.push(`row ${i} of a has ${row.length} entries, want ${i}`);
            if (!close(sum(row), t.c[i])) problems.push(`row ${i} of a sums to ${sum(row)}, c is ${t.c[i]}`);
        });
        if (!close(sum(t.b), 1)) problems.push(`b sums to ${sum(t.b)}`);
        if (t.bHat && !close(sum(t.bHat), 1)) problems.push(`bHat sums to ${sum(t.bHat)}`);
        if (!!t.bHat !== (t.errOrder !== null)) problems.push('bHat and errOrder disagree');
        if (t.fsal) {
            const last = t.a[s - 1];
            if (t.c[s - 1] !== 1 || !last.every((x, j) => close(x, t.b[j])) || t.b[s - 1] !== 0) problems.push('fsal set but the last stage is not the solution');
        }
        return problems;
    }
    for (const id of SOLVER_IDS) {
        const problems = validateTableau(SOLVERS[id]);
        if (problems.length) throw new Error(`solvers.js: solver ${id} is inconsistent: ${problems.join('; ')}`);
    }

    Object.assign(OC, { SOLVERS, SOLVER_IDS, validateTableau });
})(typeof window !== 'undefined' ? window : globalThis);
