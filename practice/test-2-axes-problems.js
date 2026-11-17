// Test 2 Practice, RIC Axes (#axes). Type A ('arrows'): a flat drawing of Earth, the target's
// orbit, the target, and three numbered arrows along +R, +I, and +C, seen from one of five
// directions; the student names the axis of each arrow. Type B ('cards'): match the parts of the
// RIC frame to their definitions. No DOM access. Load after test-2-common.js and practice-math.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const { prose, rule, note } = global.PracticeMath;

    const VIEWS = {
        left: 'View from the left',
        behind: 'View from behind',
        above: 'View from above',
        north: 'View from the north side of the orbit',
        oblique: 'Oblique view'
    };

    // Why each arrow is the axis it is, for each view.
    const WHY = {
        left: {
            R: 'points up, from Earth’s center through the target and away from Earth.',
            I: 'points left, the way the target moves along its orbit.',
            C: 'is the dot in a circle: it points straight at you. Looking at the orbit plane from its left side, the angular momentum points toward you.'
        },
        behind: {
            R: 'points up, from Earth’s center through the target and away from Earth.',
            I: 'is the cross in a circle: it points away from you. From behind, you look the way the target moves.',
            C: 'points left. With R up and I pointing away from you, $C = R \\times I$ points to your left.'
        },
        above: {
            R: 'is the dot in a circle: it points straight at you. Looking down on the target, "away from Earth" is toward you.',
            I: 'points up the page, the way the target moves along its orbit.',
            C: 'points left. With R toward you and I up the page, $C = R \\times I$ points to your left.'
        },
        north: {
            R: 'points outward, from Earth’s center through the target.',
            I: 'points along the orbit, the way the target moves (follow the arrowhead on the orbit).',
            C: 'is the dot in a circle: it points straight at you. From the north side the target moves counterclockwise, so the angular momentum points toward you.'
        },
        oblique: {
            R: 'points outward, from Earth’s center through the target.',
            I: 'points along the orbit, the way the target moves (follow the arrowhead on the orbit).',
            C: 'sticks out of the orbit plane on the north side, the side from which the motion looks counterclockwise. It is $R \\times I$.'
        }
    };

    const AXIS_OPTIONS = [{ value: 'R', html: 'R' }, { value: 'I', html: 'I' }, { value: 'C', html: 'C' }];
    const AXIS_NAME = { R: 'radial', I: 'in-track', C: 'cross-track' };

    const DECK = [
        { key: 'origin', name: 'Origin', clue: 'The target spacecraft' },
        { key: 'plane', name: 'Fundamental plane', clue: 'The target’s orbit plane' },
        { key: 'R', name: 'R axis', clue: 'Along the target’s position vector, away from Earth (up)' },
        { key: 'C', name: 'C axis', clue: 'Along the orbit’s angular momentum (left)' },
        { key: 'I', name: 'I axis', clue: '$C \\times R$: forward, along the velocity for a circular orbit' },
        { key: 'motion', name: 'Frame motion', clue: 'Turns once per rev about C' }
    ];

    function arrowsProblem() {
        const view = C2.pick(Object.keys(VIEWS));
        const arrows = C2.shuffle(['R', 'I', 'C']);
        const u = C2.stepIn(0, 355, 5);
        const fields = arrows.map((axis, k) => ({ key: 'a' + (k + 1), tex: '', name: 'Arrow ' + (k + 1), unitType: 'choice', options: AXIS_OPTIONS }));
        const answers = {};
        arrows.forEach((axis, k) => { answers['a' + (k + 1)] = { value: axis, text: axis + ' (' + AXIS_NAME[axis] + ')' }; });
        const num = axis => arrows.indexOf(axis) + 1;
        const steps = ['R', 'I', 'C'].map(axis => ({
            key: axis,
            title: 'Find ' + axis,
            result: 'Arrow ' + num(axis),
            caption: 'Arrow ' + num(axis) + ' is the ' + AXIS_NAME[axis] + ' axis, ' + axis + '.',
            methods: [{ name: 'Reason', html: rule('Arrow ' + num(axis) + ' ' + WHY[view][axis], axis + ' = arrow ' + num(axis)) }]
        }));
        steps[2].methods[0].html += note('So arrow 1 is ' + arrows[0] + ', arrow 2 is ' + arrows[1] + ', and arrow 3 is ' + arrows[2] + '.');
        return {
            type: 'arrows',
            model: { kind: 'axes', view, viewName: VIEWS[view], arrows, u },
            title: 'RIC Axes',
            prompt: prose('The drawing shows Earth, the target’s orbit (the arrowhead shows which way the target moves), the target, and three arrows from the target. Name the RIC axis each arrow points along.'),
            statement: '<div class="given-item">' + VIEWS[view] + '</div>',
            overviewCaption: 'A dot in a circle points at you; a cross in a circle points away from you.',
            limitsHtml: 'Each arrow points along the positive direction of one axis.',
            viewIsGiven: true,
            fields,
            answers,
            steps
        };
    }

    function cardsProblem() {
        return {
            type: 'cards',
            matching: true,
            title: 'The RIC Frame',
            prompt: 'Match each part of the RIC frame to its definition. Pick a card on either side, then its match.',
            deck: DECK.map(c => ({ ...c }))
        };
    }

    function generate(type) {
        if (type === 'cards') return cardsProblem();
        if (type === 'arrows') return arrowsProblem();
        return C2.chance(0.7) ? arrowsProblem() : cardsProblem();
    }

    function grade(field, text, truth) {
        if (!String(text).trim()) return 'blank';
        return String(text) === String(truth) ? 'right' : 'wrong';
    }

    global.Test2AxesProblems = { generate, grade, views: VIEWS, deck: DECK };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2AxesProblems;
