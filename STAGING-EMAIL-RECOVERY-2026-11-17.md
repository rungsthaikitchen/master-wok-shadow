# Staging email recovery

Owner's two checkout attempts were rejected by PRIVATE_FIXTURE_EMAIL_REQUIRED at 18:46 UTC. No new orders were created. The private candidate requires @example.invalid contacts, but the test instructions omitted that requirement.

Expose this known pre-write rejection through the existing committed:false / HTTP 409 contract. The browser explains the staging email requirement and releases the rejected pending attempt. An earlier uncertain attempt must first be retried unchanged to receive the confirmed rejection; edited details then use a fresh key. Generic/uncertain failures still retain the key. Production configuration and candidate email restriction are unchanged.

413 backend tests and 92 website tests pass, including rollback-before-persistence and uncertain → definite rejection → corrected-email retry. Staging runtime v85 probe returned HTTP 409, committed:false, PRIVATE_FIXTURE_EMAIL_REQUIRED without any booking or provider request. Preview branch fix/availability-checks includes the recovery message. Use david@example.invalid for the owner-led staging checkout test.
