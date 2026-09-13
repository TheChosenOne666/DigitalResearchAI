import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  SearchUploadService,
  type UploadedFileShape,
  type UploadFileResult,
} from './search-upload.service';

/**
 * 智搜补充上传控制器（18 智搜增强批 3）。
 *
 * `POST /search/uploads`：多文件上传（字段名 `files`）→ 逐个解析为「本地资料」来源，
 * 返回每个文件的结果（成功带 id，失败带原因）；id 随后作为 `search/stream` 的 `uploadIds` 传入。
 * 上传不单独计费（计费仍在检索段）。
 */
@Controller('search')
export class SearchUploadController {
  constructor(private readonly uploadService: SearchUploadService) {}

  @Post('uploads')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('files', MAX_UPLOAD_FILES, {
      // 注意 1：multer 的 fileSize 是**请求级硬限制**，超限会整体 413，
      // 与「单个文件超限只标记该文件失败、不阻断其它文件」的需求冲突。
      // 故此处放宽到 2 倍作为内存保护线，精确的 20MB 校验由 service 逐文件完成。
      limits: { fileSize: MAX_UPLOAD_BYTES * 2 },
      // 注意 2：multer 默认按 latin1 解码 multipart 的 filename，中文文件名会变乱码
      //（「A资料.txt」→「Aèµæ.txt」），必须显式指定 utf8。
      defParamCharset: 'utf8',
    }),
  )
  async upload(@UploadedFiles() files?: UploadedFileShape[]): Promise<{ files: UploadFileResult[] }> {
    return { files: await this.uploadService.save(files ?? []) };
  }
}
