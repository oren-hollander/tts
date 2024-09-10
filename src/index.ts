import { OpenAI } from 'openai'
import { readFile, writeFile, rm } from 'fs/promises'
import { cwd } from 'process'
import { spawn } from 'child_process'
import { join } from 'path'
import ms from 'ms'
import { SpeechModel } from 'openai/src/resources/audio/speech'
import { config } from 'dotenv-flow'

const apiKey = config<{ OPENAI_API_KEY: string }>().parsed!.OPENAI_API_KEY

const client = new OpenAI({ apiKey })

const maxParagraphLength = 4096

const splitParagraph = (paragraph: string): string[] => {
  const words = paragraph.split(/\s+/)
  const result: string[] = []
  let currentChunk = ''

  for (const word of words) {
    if ((currentChunk + word).length > maxParagraphLength) {
      result.push(currentChunk.trim())
      currentChunk = ''
    }

    currentChunk += word + ' '
  }

  if (currentChunk.trim()) {
    result.push(currentChunk.trim())
  }

  return result
}

const splitToParagraphs = (content: string): string[] => {
  content = content.replace(/\r\n|\r|\n/g, '\n')
  const paragraphs = content
    .split('\n\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/\n/g, ' '))
    .flatMap((p) => (p.length <= maxParagraphLength ? [p] : splitParagraph(p)))

  const result = []
  let currentChunk = ''

  for (let paragraph of paragraphs) {
    if ((currentChunk + paragraph + '\n').length > maxParagraphLength) {
      result.push(currentChunk)
      currentChunk = ''
    }

    currentChunk += paragraph + '\n'
  }

  if (currentChunk) {
    result.push(currentChunk)
  }

  return result
}

const loadFile = async (model: SpeechModel): Promise<string> => {
  const charPrice = (model === 'tts-1' ? 15 : 30) / 1000000
  let content = await readFile(join(cwd(), 'audio', 'document.txt'), 'utf-8')
  console.log(`Document size: ${content.length}, estimated price: ${content.length * charPrice}`)

  return content
}

const textToSpeech = async (text: string, model: SpeechModel, paragraphNumber: number): Promise<string> => {
  const response = await client.audio.speech.create({
    input: text,
    model,
    voice: 'nova',
    response_format: 'flac',
  })
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const fileName = join(cwd(), 'audio', `p-${paragraphNumber}.flac`)
  await writeFile(fileName, buffer)
  return fileName
}

export const mergeAudio = async (fileListPath: string, outputPath: string) => {
  const ffmpeg = spawn('ffmpeg', [
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    fileListPath,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '192k',
    outputPath,
  ])

  ffmpeg.stdout.on('data', (data) => {
    console.log(`FFmpeg stdout: ${data}`)
  })

  ffmpeg.stderr.on('data', (data) => {
    const message = data.toString()

    if (message.toLowerCase().includes('error')) {
      console.error(`FFmpeg error: ${message}`)
    } else {
      console.log(`FFmpeg info: ${message}`)
    }
  })

  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg process exited with code ${code}`)
  })
}

const main = async () => {
  const model: SpeechModel = 'tts-1'
  await rm(join(cwd(), 'audio', 'output.mp3'), { recursive: true, force: true })
  const start = performance.now()

  const content = await loadFile(model)
  const paragraphs = splitToParagraphs(content)

  let paragraphNumber = 1
  const fileNames: string[] = []
  for (let paragraph of paragraphs) {
    process.stdout.write('Creating paragraph...')
    const fileName = await textToSpeech(paragraph, model, paragraphNumber)
    fileNames.push(fileName)
    console.log(`${paragraphNumber}/${paragraphs.length} created`)
    paragraphNumber++
  }

  const fileListPath = join(cwd(), 'audio', 'file-list.txt')
  await writeFile(fileListPath, fileNames.map((fn) => `file '${fn}'`).join('\n'))
  await mergeAudio(fileListPath, join(cwd(), 'audio', 'output.mp3'))
  const end = performance.now()
  console.log(`Execution time: ${ms(end - start)}`)
}

// main().catch(console.error)
