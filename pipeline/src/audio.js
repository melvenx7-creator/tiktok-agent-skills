// Pure-JS audio duration readers, so the pipeline needs no ffmpeg/ffprobe.
// Durations drive image timing, so they need to be accurate (within ~1 frame).

const MPEG1_L3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
// Keyed by the 2-bit version field: 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function parseFrameHeader(buf, pos) {
  if (buf[pos] !== 0xff || (buf[pos + 1] & 0xe0) !== 0xe0) return null;
  const version = (buf[pos + 1] >> 3) & 3;
  const layer = (buf[pos + 1] >> 1) & 3;
  if (version === 1 || layer !== 1) return null; // only MPEG Layer III (what TTS services emit)
  const bitrateIndex = buf[pos + 2] >> 4;
  const rateIndex = (buf[pos + 2] >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const padding = (buf[pos + 2] >> 1) & 1;
  const kbps = (version === 3 ? MPEG1_L3_KBPS : MPEG2_L3_KBPS)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const samples = version === 3 ? 1152 : 576;
  const frameLength = Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding;
  return { sampleRate, samples, frameLength };
}

function isInfoFrame(buf, pos) {
  const probe = buf.toString('latin1', pos + 4, Math.min(pos + 44, buf.length));
  return probe.includes('Xing') || probe.includes('Info');
}

export function mp3DurationSeconds(buffer) {
  let pos = 0;
  if (buffer.length >= 10 && buffer.toString('latin1', 0, 3) === 'ID3') {
    const size =
      ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    pos = 10 + size + (buffer[5] & 0x10 ? 10 : 0);
  }
  let seconds = 0;
  let frames = 0;
  let first = true;
  while (pos + 4 <= buffer.length) {
    const header = parseFrameHeader(buffer, pos);
    if (!header) {
      pos += 1;
      continue;
    }
    if (pos + header.frameLength > buffer.length) break;
    if (first && isInfoFrame(buffer, pos)) {
      first = false; // encoder metadata frame, not audio
      pos += header.frameLength;
      continue;
    }
    first = false;
    seconds += header.samples / header.sampleRate;
    frames += 1;
    pos += header.frameLength;
  }
  if (frames === 0) throw new Error('Could not read MP3 duration: no valid audio frames found.');
  return seconds;
}

export function wavDurationSeconds(buffer) {
  if (buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file.');
  }
  let byteRate = 0;
  let pos = 12;
  while (pos + 8 <= buffer.length) {
    const id = buffer.toString('latin1', pos, pos + 4);
    let size = buffer.readUInt32LE(pos + 4);
    if (id === 'fmt ') byteRate = buffer.readUInt32LE(pos + 16);
    if (id === 'data') {
      if (!byteRate) throw new Error('WAV data chunk found before fmt chunk.');
      if (size === 0xffffffff || pos + 8 + size > buffer.length) size = buffer.length - (pos + 8);
      return size / byteRate;
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk.');
}

export function audioDurationSeconds(buffer, format = 'mp3') {
  if (format === 'mp3') return mp3DurationSeconds(buffer);
  if (format === 'wav') return wavDurationSeconds(buffer);
  throw new Error(`Unsupported audio format for duration: ${format}`);
}
