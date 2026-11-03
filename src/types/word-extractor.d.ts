declare module "word-extractor" {
  interface ExtractedDocument {
    getBody(): string;
  }

  export default class WordExtractor {
    extract(input: string | Buffer): Promise<ExtractedDocument>;
  }
}
