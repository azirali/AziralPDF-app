package stirling.software.common.util;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import javax.imageio.ImageIO;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.multipart.MultipartFile;

import com.github.junrar.Archive;
import com.github.junrar.rarfile.FileHeader;

import stirling.software.common.service.CustomPDFDocumentFactory;

class PdfToCbrUtilsTest {

    @TempDir Path temporaryDirectory;

    @Test
    void convertPdfToCbr_extractsValidPngPagesWithIndependentRarReader() throws Exception {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("comic.pdf");
        PDDocument document = new PDDocument();
        for (Color color : List.of(Color.RED, Color.BLUE)) {
            PDPage page = new PDPage(new PDRectangle(72, 72));
            document.addPage(page);
            try (PDPageContentStream content = new PDPageContentStream(document, page)) {
                content.setNonStrokingColor(color);
                content.addRect(0, 0, 72, 72);
                content.fill();
            }
        }
        CustomPDFDocumentFactory factory = mock(CustomPDFDocumentFactory.class);
        when(factory.load(file)).thenReturn(document);

        byte[] result = PdfToCbrUtils.convertPdfToCbr(file, 72, factory);
        Path cbr = temporaryDirectory.resolve("comic.cbr");
        Files.write(cbr, result);
        try (Archive archive = new Archive(cbr.toFile())) {
            List<FileHeader> pages = archive.getFileHeaders();
            assertEquals(
                    List.of("page_001.png", "page_002.png"),
                    pages.stream().map(FileHeader::getFileName).toList());
            for (int index = 0; index < pages.size(); index++) {
                ByteArrayOutputStream extracted = new ByteArrayOutputStream();
                archive.extractFile(pages.get(index), extracted);
                BufferedImage image =
                        ImageIO.read(new ByteArrayInputStream(extracted.toByteArray()));
                assertNotNull(image);
                assertEquals(72, image.getWidth());
                assertEquals(72, image.getHeight());
                assertEquals(
                        index == 0 ? Color.RED.getRGB() : Color.BLUE.getRGB(),
                        image.getRGB(36, 36));
            }
        }
    }

    @Test
    void isPdfFile_pdfExtension_returnsTrue() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("document.pdf");
        assertTrue(PdfToCbrUtils.isPdfFile(file));
    }

    @Test
    void isPdfFile_uppercasePdfExtension_returnsTrue() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("document.PDF");
        assertTrue(PdfToCbrUtils.isPdfFile(file));
    }

    @Test
    void isPdfFile_mixedCasePdfExtension_returnsTrue() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("document.Pdf");
        assertTrue(PdfToCbrUtils.isPdfFile(file));
    }

    @Test
    void isPdfFile_nonPdfExtension_returnsFalse() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("document.txt");
        assertFalse(PdfToCbrUtils.isPdfFile(file));
    }

    @Test
    void isPdfFile_nullFilename_returnsFalse() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn(null);
        assertFalse(PdfToCbrUtils.isPdfFile(file));
    }

    @Test
    void isPdfFile_imageExtension_returnsFalse() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("image.png");
        assertFalse(PdfToCbrUtils.isPdfFile(file));
    }

    @Test
    void convertPdfToCbr_nullFile_throwsException() {
        assertThrows(Exception.class, () -> PdfToCbrUtils.convertPdfToCbr(null, 300, null));
    }

    @Test
    void convertPdfToCbr_emptyFile_throwsException() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(true);
        assertThrows(Exception.class, () -> PdfToCbrUtils.convertPdfToCbr(file, 300, null));
    }

    @Test
    void convertPdfToCbr_nonPdfFile_throwsException() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(false);
        when(file.getOriginalFilename()).thenReturn("image.png");
        assertThrows(Exception.class, () -> PdfToCbrUtils.convertPdfToCbr(file, 300, null));
    }

    @Test
    void convertPdfToCbr_nullFilename_throwsException() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(false);
        when(file.getOriginalFilename()).thenReturn(null);
        assertThrows(Exception.class, () -> PdfToCbrUtils.convertPdfToCbr(file, 300, null));
    }
}
