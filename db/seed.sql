SET search_path = fsm, public;
INSERT INTO businesses VALUES ('demo','Example Home Services','America/New_York'),('other','Other Fictional Business','America/New_York');
INSERT INTO team_members VALUES
 ('owner','demo','Avery Morgan','avery@example.test','owner',true),
 ('tech-jordan','demo','Jordan Lee','jordan@example.test','tech',true),
 ('tech-sam','demo','Sam Rivera','sam@example.test','tech',true),
 ('other-owner','other','Other Owner','other@example.test','owner',true);
INSERT INTO customers VALUES ('customer-1','demo','Taylor Brooks','taylor@example.test'),('customer-2','demo','Casey Ellis','casey@example.test'),('customer-3','demo','Robin Chen','robin@example.test'),('other-customer','other','Other Customer','other-customer@example.test');
INSERT INTO properties VALUES ('property-1','demo','customer-1','12 Example Lane','Fictional Springs'),('property-2','demo','customer-2','48 Sample Court','Fictional Springs'),('property-3','demo','customer-3','9 Demo Avenue','Fictional Springs'),('other-property','other','other-customer','1 Other Street','Example Town');
INSERT INTO equipment VALUES ('equipment-1','demo','property-1','Heat pump','Example HVAC','DEMO-HP-24','FICTIONAL-001'),('equipment-2','demo','property-2','Electrical panel','Example Electric','DEMO-200','FICTIONAL-002');
INSERT INTO jobs(id,business_id,customer_id,property_id,job_number,title,description,status,primary_team_member_id,scheduled_start,scheduled_end) VALUES
 ('job-1','demo','customer-1','property-1',1001,'Heat pump diagnosis','Investigate intermittent heating. All details are fictional.','scheduled','tech-jordan',date_trunc('day',now())+interval '9 hours',date_trunc('day',now())+interval '10 hours'),
 ('job-2','demo','customer-2','property-2',1002,'Electrical panel inspection','Inspect the fictional panel and record observations.','scheduled','tech-sam',date_trunc('day',now())+interval '10 hours',date_trunc('day',now())+interval '11 hours'),
 ('job-3','demo','customer-3','property-3',1003,'Bathroom fixture service','A fictional job waiting for dispatch.','unscheduled',null,null,null),
 ('job-4','demo','customer-1','property-1',1004,'Heating system repair','Two seeded visits demonstrate the existing completion guard.','in_progress','tech-jordan',date_trunc('day',now())-interval '1 day'+interval '9 hours',date_trunc('day',now())-interval '1 day'+interval '10 hours'),
 ('other-job','other','other-customer','other-property',1001,'Other tenant job','Tenant-isolation fixture.','scheduled','other-owner',date_trunc('day',now())+interval '12 hours',date_trunc('day',now())+interval '13 hours');
INSERT INTO visits(id,business_id,job_id,visit_type,sequence_number,status,scheduled_start,scheduled_end,assigned_team_member_id,completion_notes) VALUES
 ('visit-1','demo','job-1','diagnostic',1,'scheduled',date_trunc('day',now())+interval '9 hours',date_trunc('day',now())+interval '10 hours','tech-jordan',null),
 ('visit-2','demo','job-2','work',1,'scheduled',date_trunc('day',now())+interval '10 hours',date_trunc('day',now())+interval '11 hours','tech-sam',null),
 ('visit-3','demo','job-4','diagnostic',1,'complete',date_trunc('day',now())-interval '1 day'+interval '9 hours',date_trunc('day',now())-interval '1 day'+interval '10 hours','tech-jordan','Fictional diagnosis: replacement part required.'),
 ('visit-4','demo','job-4','follow_up',2,'scheduled',date_trunc('day',now())+interval '13 hours',date_trunc('day',now())+interval '14 hours','tech-jordan',null),
 ('other-visit','other','other-job','work',1,'scheduled',date_trunc('day',now())+interval '12 hours',date_trunc('day',now())+interval '13 hours','other-owner',null);
