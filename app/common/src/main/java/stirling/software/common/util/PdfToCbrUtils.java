package stirling.software.common.util;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.zip.CRC32;

import javax.imageio.ImageIO;

import org.apache.commons.io.FilenameUtils;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.web.multipart.MultipartFile;

import lombok.extern.slf4j.Slf4j;

import stirling.software.common.service.CustomPDFDocumentFactory;

@Slf4j
public class PdfToCbrUtils {

    public static byte[] convertPdfToCbr(
            MultipartFile pdfFile, int dpi, CustomPDFDocumentFactory pdfDocumentFactory)
            throws IOException {

        validatePdfFile(pdfFile);

        try (PDDocument document = pdfDocumentFactory.load(pdfFile)) {
            if (document.getNumberOfPages() == 0) {
                throw ExceptionUtils.createPdfNoPages();
            }

            return createCbrFromPdf(document, dpi);
        }
    }

    private static void validatePdfFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw ExceptionUtils.createFileNullOrEmptyException();
        }

        String filename = file.getOriginalFilename();
        if (filename == null) {
            throw ExceptionUtils.createFileNoNameException();
        }

        String extension = FilenameUtils.getExtension(filename).toLowerCase(Locale.ROOT);
        if (!"pdf".equals(extension)) {
            throw ExceptionUtils.createPdfFileRequiredException();
        }
    }

    private static byte[] createCbrFromPdf(PDDocument document, int dpi) throws IOException {
        PDFRenderer pdfRenderer = new PDFRenderer(document);
        pdfRenderer.setSubsamplingAllowed(true); // Enable subsampling to reduce memory usage

        Path tempDir = Files.createTempDirectory("stirling-pdf-cbr-");
        List<Path> generatedImages = new ArrayList<>();
        try {
            int totalPages = document.getNumberOfPages();

            for (int pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                final int currentPage = pageIndex;
                try {
                    BufferedImage image =
                            ExceptionUtils.handleOomRendering(
                                    currentPage + 1,
                                    dpi,
                                    () ->
                                            pdfRenderer.renderImageWithDPI(
                                                    currentPage, dpi, ImageType.RGB));

                    String imageFilename =
                            String.format(Locale.ROOT, "page_%03d.png", currentPage + 1);
                    Path imagePath = tempDir.resolve(imageFilename);

                    ImageIO.write(image, "PNG", imagePath.toFile());
                    generatedImages.add(imagePath);

                } catch (ExceptionUtils.OutOfMemoryDpiException e) {
                    // Re-throw OOM exceptions without wrapping
                    throw e;
                } catch (IOException e) {
                    // Wrap other IOExceptions with context
                    throw ExceptionUtils.createFileProcessingException(
                            "CBR creation for page " + (currentPage + 1), e);
                }
            }

            if (generatedImages.isEmpty()) {
                throw ExceptionUtils.createFileProcessingException(
                        "CBR conversion", new IOException("No pages were successfully rendered"));
            }

            return createRarArchive(generatedImages);
        } finally {
            cleanupTempFiles(generatedImages, tempDir);
        }
    }

    private static byte[] createRarArchive(List<Path> images) throws IOException {
        // PNG data is already compressed. RAR's stored method needs no external compressor.
        try (ByteArrayOutputStream archive = new ByteArrayOutputStream()) {
            archive.write(new byte[] {'R', 'a', 'r', '!', 0x1a, 0x07, 0x00});
            ByteBuffer mainHeader = rarHeader(0x73, 0, 13);
            mainHeader.putShort((short) 0).putInt(0);
            writeRarHeader(archive, mainHeader.array());

            for (Path image : images) {
                byte[] name = image.getFileName().toString().getBytes(StandardCharsets.US_ASCII);
                long size = Files.size(image);
                if (size > 0xffffffffL) {
                    throw new IOException(
                            "Rendered CBR page exceeds the RAR stored-file size limit");
                }
                CRC32 dataCrc = new CRC32();
                try (InputStream input = Files.newInputStream(image)) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        dataCrc.update(buffer, 0, count);
                    }
                }

                ByteBuffer fileHeader = rarHeader(0x74, 0x8000, 32 + name.length);
                fileHeader.putInt((int) size).putInt((int) size);
                fileHeader.put((byte) 3); // Unix host.
                fileHeader.putInt((int) dataCrc.getValue());
                fileHeader.putInt(0x00210000); // DOS epoch: 1980-01-01 00:00:00.
                fileHeader.put((byte) 20).put((byte) 0x30); // RAR 2.0, stored method.
                fileHeader.putShort((short) name.length).putInt(0100644).put(name);
                writeRarHeader(archive, fileHeader.array());
                Files.copy(image, archive);
            }

            writeRarHeader(archive, rarHeader(0x7b, 0x4000, 7).array());
            return archive.toByteArray();
        }
    }

    private static ByteBuffer rarHeader(int type, int flags, int size) {
        ByteBuffer header = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
        header.position(2); // Header CRC is filled after all fields have been written.
        header.put((byte) type).putShort((short) flags).putShort((short) size);
        return header;
    }

    private static void writeRarHeader(ByteArrayOutputStream archive, byte[] header)
            throws IOException {
        CRC32 crc = new CRC32();
        crc.update(header, 2, header.length - 2);
        header[0] = (byte) crc.getValue();
        header[1] = (byte) (crc.getValue() >>> 8);
        archive.write(header);
    }

    private static void cleanupTempFiles(List<Path> images, Path tempDir) {
        for (Path image : images) {
            try {
                Files.deleteIfExists(image);
            } catch (IOException e) {
                log.warn("Failed to delete temp image file {}: {}", image, e.getMessage());
            }
        }
        if (tempDir != null) {
            try (var paths = Files.walk(tempDir)) {
                paths.sorted(Comparator.reverseOrder())
                        .forEach(
                                path -> {
                                    try {
                                        Files.deleteIfExists(path);
                                    } catch (IOException e) {
                                        log.warn(
                                                "Failed to delete temp path {}: {}",
                                                path,
                                                e.getMessage());
                                    }
                                });
            } catch (IOException e) {
                log.warn("Failed to clean up temp directory {}: {}", tempDir, e.getMessage());
            }
        }
    }

    public static boolean isPdfFile(MultipartFile file) {
        String filename = file.getOriginalFilename();
        if (filename == null) {
            return false;
        }

        String extension = FilenameUtils.getExtension(filename).toLowerCase(Locale.ROOT);
        return "pdf".equals(extension);
    }
}
