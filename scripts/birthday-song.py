# Happy Birthday (public-domain melody) as a bright waltz: piano melody, glockenspiel sparkle, oom-pah-pah accompaniment.
import sys, wave
import numpy as np

RATE, BEAT = 44100, 0.46
NOTE = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}
def freq(name):
    pitch, octave = name[:-1], int(name[-1])
    return 440 * 2 ** ((NOTE[pitch] + 12 * (octave + 1) - 69) / 12)

melody = [('G4', .75), ('G4', .25), ('A4', 1), ('G4', 1), ('C5', 1), ('B4', 2),
          ('G4', .75), ('G4', .25), ('A4', 1), ('G4', 1), ('D5', 1), ('C5', 2),
          ('G4', .75), ('G4', .25), ('G5', 1), ('E5', 1), ('C5', 1), ('B4', 1), ('A4', 1),
          ('F5', .75), ('F5', .25), ('E5', 1), ('C5', 1), ('D5', 1), ('C5', 3)]
# One bar after the one-beat pickup: bass note, then a chord on beats two and three.
C, G7, F = ['E4', 'G4', 'C5'], ['D4', 'F4', 'B4'], ['F4', 'A4', 'C5']
bars = [('C3', C, C), ('G2', G7, G7), ('G2', G7, G7), ('C3', C, C), ('C3', C, C), ('F2', F, F), ('G2', C, G7), ('C3', C, C)]
# The name ("dear ...") is held a little: the A4 on beat 17 stretches by 0.7 beat.
def sec(beat): return (beat + .7 * min(max(beat - 17, 0), 1)) * BEAT
total = sec(1 + 3 * len(bars)) + 2.0
out = np.zeros(int(total * RATE))

# A note decays while held and fades out quickly once released, so it doesn't blur into the next one.
def add(start, f, hold, volume, partials, decay):
    n = int((hold + .3) * RATE); t = np.arange(n) / RATE
    tone = sum(a * np.sin(2 * np.pi * f * k * t) for k, a in partials)
    env = np.minimum(t / .006, 1) * np.exp(-decay * t) * np.exp(-18 * np.maximum(t - hold, 0))
    i = int(start * RATE); end = min(i + n, len(out))
    out[i:end] += volume * (tone * env)[:end - i]

piano = [(1, 1), (2, .45), (3, .22), (4, .12), (5, .06)]
bell = [(1, 1), (2.76, .35), (5.4, .12)]
at = 0.0
for note, beats in melody:
    f = freq(note)
    add(sec(at), f, sec(at + beats) - sec(at), .5, piano, 2.4)
    add(sec(at), f * 2, .6, .12, bell, 4.5)
    at += beats
for bar, (bass, *chords) in enumerate(bars):
    start = 1 + 3 * bar
    add(sec(start), freq(bass), BEAT * 1.4, .32, piano, 3.0)
    for beat, chord in zip((1, 2), chords):
        for note in chord: add(sec(start + beat), freq(note), BEAT * .9, .07, piano, 6.0)
# The last bar rings: a full chord under the final note.
for note in ['C3', 'G3', 'E4', 'G4', 'C5']: add(sec(1 + 3 * 7), freq(note), 3.0, .12, piano, 1.4)

# A short room echo so it doesn't sound dry.
wet = out.copy()
for delay, gain in [(.043, .25), (.071, .18), (.113, .12), (.157, .08)]:
    d = int(delay * RATE); wet[d:] += gain * out[:-d]
wet /= np.abs(wet).max() / .89
fade = int(.5 * RATE); wet[-fade:] *= np.linspace(1, 0, fade)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
    w.writeframes((wet * 32767).astype('<i2').tobytes())
