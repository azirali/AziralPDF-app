package stirling.software.proprietary.security.billing;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.InputSource;

public final class FreedomPayProtocol {
    private FreedomPayProtocol() {}

    // MD5 is mandated by Freedom Pay's signed Merchant API; never used for passwords.
    public static String sign(String script, Map<String, String> fields, String secret) {
        TreeMap<String, String> sorted = new TreeMap<>(fields);
        sorted.remove("pg_sig");
        String value = script + ";" + String.join(";", sorted.values()) + ";" + secret;
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("MD5")
                                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public static boolean verify(String script, Map<String, String> fields, String secret) {
        String signature = fields.get("pg_sig");
        if (secret == null
                || secret.isBlank()
                || signature == null
                || !signature.matches("[a-f0-9]{32}")
                || fields.getOrDefault("pg_salt", "").isBlank()) return false;
        return MessageDigest.isEqual(
                sign(script, fields, secret).getBytes(StandardCharsets.US_ASCII),
                signature.getBytes(StandardCharsets.US_ASCII));
    }

    public static Map<String, String> parseXml(String xml) {
        if (xml == null || xml.length() > 65536)
            throw new IllegalArgumentException("Invalid gateway response");
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            Element root =
                    factory.newDocumentBuilder()
                            .parse(new InputSource(new StringReader(xml)))
                            .getDocumentElement();
            if (!"response".equals(root.getTagName()) && !"root".equals(root.getTagName()))
                throw new IllegalArgumentException("Invalid gateway root");
            Map<String, String> fields = new LinkedHashMap<>();
            for (Node child = root.getFirstChild(); child != null; child = child.getNextSibling()) {
                if (!(child instanceof Element element)) continue;
                for (Node nested = element.getFirstChild();
                        nested != null;
                        nested = nested.getNextSibling()) {
                    if (nested instanceof Element)
                        throw new IllegalArgumentException(
                                "Nested gateway response is not supported");
                }
                if (fields.put(element.getTagName(), element.getTextContent()) != null)
                    throw new IllegalArgumentException("Duplicate gateway field");
            }
            return fields;
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid gateway XML", e);
        }
    }

    public static String acknowledgment(String script, String status, String secret) {
        Map<String, String> fields =
                new TreeMap<>(
                        Map.of(
                                "pg_status",
                                status,
                                "pg_description",
                                "AziralPDF",
                                "pg_salt",
                                UUID.randomUUID().toString().replace("-", "")));
        fields.put("pg_sig", sign(script, fields, secret));
        StringBuilder xml =
                new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?><response>");
        fields.forEach(
                (key, value) ->
                        xml.append('<')
                                .append(key)
                                .append('>')
                                .append(value)
                                .append("</")
                                .append(key)
                                .append('>'));
        return xml.append("</response>").toString();
    }
}
